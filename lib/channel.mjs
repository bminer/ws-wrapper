// TODO: Use native "events" module if in Node.js environment?
import { EventEmitter } from "eventemitter3"

/* A WebSocketChannel exposes an EventEmitter-like API for sending and handling
	events or requests over the channel through the attached WebSocketWrapper.

	`var channel = new WebSocketChannel(name, socketWrapper);`
		- `name` - the namespace for the channel
		- `socketWrapper` - the WebSocketWrapper instance to which data should
			be sent
*/
class WebSocketChannel {
	constructor(name, socketWrapper) {
		// Channel name; `null` only for the WebSocketWrapper instance
		this._name = name
		// Reference to WebSocketWrapper instance
		this._wrapper = socketWrapper
		// This channel's EventEmitter
		this._emitter = new EventEmitter()
		// WeakMap of wrapped event listeners
		this._wrappedListeners = new WeakMap()
		// Channel middleware added using `use()` method
		this._middleware = []
		// Flag marking this as an anonymous (request-scoped) channel
		this._isAnonymous = false
		// Anonymous channels inherit the optional signal associated with the
		// original request. If this signal aborts, we call `abort` on the
		// channel.
		this._requestSignal = null
		this._onRequestAbort = () => this.abort()
		// AbortController used to notify listeners when the channel closes
		if (typeof AbortController === "function") {
			this._closeController = new AbortController()
		}
	}

	/**
	 * Read-only channel namespace. `null` for the root wrapper.
	 * @type {string|null}
	 */
	get name() {
		return this._name
	}
	/**
	 * `true` for anonymous (request-scoped) channels; `false` for named channels
	 * and the root wrapper.
	 * @type {boolean}
	 */
	get isAnonymous() {
		return this._isAnonymous
	}
	/**
	 * An `AbortSignal` aborted when the channel is closed or aborted. `null` if
	 * the runtime does not support `AbortController`. The signal's `reason`
	 * reflects the value passed to `close(reason)` or `abort(err)`.
	 * @type {AbortSignal|null}
	 */
	get closeSignal() {
		const ac = this._closeController
		return ac ? ac.signal : null
	}

	/**
	 * Register a persistent listener for `eventName`. For ws-wrapper events the
	 * listener receives deserialized arguments from the remote peer. Inside a
	 * request handler, `this` exposes `this.signal` and `this.channel()`.
	 *
	 * When `eventName` is one of the `NO_WRAP_EVENTS`, the event handler is
	 * left untouched and the emitted event is delivered directly to the
	 * EventEmitter; otherwise, the listener is wrapped to handle the incoming
	 * request and emitted events are serialized and sent over the WebSocket.
	 * @param {string} eventName
	 * @param {Function} listener
	 * @returns {WebSocketChannel} This channel for chaining
	 */
	on(eventName, listener) {
		const e = this._emitter
		if (this._wrapEvent(eventName)) {
			e.on(eventName, this._wrapListener(listener))
		} else {
			/* Note: The following is equivalent to:
					`this._emitter.on(eventName, listener.bind(this));`
				But thanks to eventemitter3, the following is a touch faster. */
			e.on(eventName, listener, this)
		}
		return this
	}

	/**
	 * Register a one-time listener that is automatically removed after firing
	 * once.
	 * @param {string} eventName
	 * @param {Function} listener
	 * @returns {WebSocketChannel} This channel for chaining
	 */
	once(eventName, listener) {
		const e = this._emitter
		if (this._wrapEvent(eventName)) {
			e.once(eventName, this._wrapListener(listener))
		} else {
			e.once(eventName, listener, this)
		}
		return this
	}

	/**
	 * Remove a previously registered listener.
	 * @param {string} eventName
	 * @param {Function} listener
	 * @returns {WebSocketChannel} This channel for chaining
	 */
	removeListener(eventName, listener) {
		const e = this._emitter
		if (this._wrapEvent(eventName)) {
			e.removeListener(eventName, this._wrappedListeners.get(listener))
		} else {
			e.removeListener(eventName, listener)
		}
		return this
	}

	/**
	 * Remove all listeners for `eventName`, or all listeners for all events if
	 * `eventName` is omitted.
	 * @param {string} [eventName]
	 * @returns {WebSocketChannel} This channel for chaining
	 */
	removeAllListeners(eventName) {
		this._emitter.removeAllListeners(eventName)
		return this
	}

	/**
	 * Returns the names of all events that have at least one registered
	 * listener.
	 * @returns {string[]}
	 */
	eventNames() {
		return this._emitter.eventNames()
	}

	/**
	 * Returns the listeners registered for `eventName`.
	 * @param {string} eventName
	 * @returns {Function[]}
	 */
	listeners(eventName) {
		const e = this._emitter
		if (this._wrapEvent(eventName)) {
			return e.listeners(eventName).map((wrapper) => wrapper._original)
		} else {
			return e.listeners(eventName)
		}
	}

	/**
	 * Emit an event to the remote peer over the WebSocket. For reserved events
	 * on the root wrapper, emits locally instead. Throws if the channel is closed.
	 * @param {string} eventName
	 * @param {...any} args
	 */
	emit(eventName) {
		if (!this._wrapEvent(eventName)) {
			return this._emitter.emit.apply(this._emitter, arguments)
		}
		const wrapper = this._wrapper
		if (
			// closed or not yet open
			!wrapper ||
			(this._isAnonymous &&
				wrapper._anonymousChannels.get(+this._name) !== this)
		) {
			throw new Error("Cannot emit on a closed channel")
		}
		return wrapper._sendEvent(this._name, eventName, arguments, {
			isRequest: false,
			isAnonymous: this._isAnonymous,
		})
	}

	/**
	 * Temporarily set the request timeout for the next request only.
	 * @param {number} tempTimeout - Timeout in milliseconds
	 * @returns {WebSocketChannel} This channel for chaining
	 */
	timeout(tempTimeout) {
		this._tempTimeout = tempTimeout
		return this
	}

	/**
	 * Temporarily set the AbortSignal for the next request only.
	 * @param {AbortSignal} abortSignal - AbortSignal to enable request cancellation
	 * @returns {WebSocketChannel} This channel for chaining
	 */
	signal(abortSignal) {
		this._tempSignal = abortSignal
		return this
	}

	/**
	 * Send a request over the WebSocket and return a Promise that resolves when a response is received.
	 * @param {string} eventName - The event name to send
	 * @param {...any} args - Arguments to pass to the remote event handler
	 * @returns {Promise<any>} Promise that resolves with the response data or rejects on error/timeout/cancellation
	 */
	request(eventName) {
		const requestTimeout = this._tempTimeout
		if (this._tempTimeout !== undefined) {
			delete this._tempTimeout
		}
		const signal = this._tempSignal
		if (this._tempSignal !== undefined) {
			delete this._tempSignal
		}
		const wrapper = this._wrapper
		if (
			// closed or not yet open
			!wrapper ||
			(this._isAnonymous &&
				wrapper._anonymousChannels.get(+this._name) !== this)
		) {
			throw new Error("Cannot send request on a closed channel")
		}
		return wrapper._sendEvent(this._name, eventName, arguments, {
			isRequest: true,
			signal,
			requestTimeout,
			isAnonymous: this._isAnonymous,
		})
	}

	/**
	 * Remove this channel from its wrapper and clean up all listeners,
	 * middleware, and abort signal subscriptions. The optional `reason` is
	 * forwarded to `closeSignal.reason`.
	 * @param {any} [reason]
	 */
	close(reason) {
		const chanName = this._name
		if (!this._wrapper || chanName == null) {
			return // already closed or cannot close
		}
		const { _channels: chans, _anonymousChannels: anonChans } = this._wrapper
		// Remove event handlers, middleware, and disconnect from wrapper
		this._emitter.removeAllListeners()
		this._middleware = []
		this._wrapper = null
		if (this._isAnonymous) {
			// Remove channel from wrapper
			if (anonChans.get(+chanName) === this) {
				anonChans.delete(+chanName)
			}
			// Remove event listener for request abort (if any)
			if (this._requestSignal) {
				this._requestSignal.removeEventListener("abort", this._onRequestAbort)
			}
			this._requestSignal = null
		} else if (chans.get(chanName) === this) {
			chans.delete(chanName)
		}
		// Notify close listeners, forwarding the reason if provided
		const ac = this._closeController
		if (ac) ac.abort(reason)
	}

	/**
	 * Send a cancellation message to the remote peer and close this anonymous
	 * channel. A no-op for non-anonymous channels or if the channel is already
	 * closed. `err` is serialized as the cancellation reason; if omitted a
	 * default {@link RequestAbortedError} is sent.
	 * @param {Error} [err]
	 */
	abort(err) {
		const wrapper = this._wrapper
		if (wrapper && this._isAnonymous) {
			wrapper._sendCancelAnon(this._name, err)
		}
		this.close()
	}

	/**
	 * Add a middleware function for this channel. Middleware runs before event
	 * handlers and can inspect, modify, or block incoming events by calling
	 * `next(err)`.
	 * @param {Function} fn
	 * @returns {WebSocketChannel} This channel for chaining
	 */
	use(fn) {
		if (typeof fn !== "function") {
			throw new Error("Middleware must be a function")
		}
		this._middleware.push(fn)
		return this
	}

	// Receives an inbound message directed to this channel. Returns true if
	// and only if an event handler processed the inbound message. Events first
	// pass through all middleware and then to the event handler for
	// `eventName`. If any middleware function returns an error, then the
	// message will be "dropped" and never seen by the registered event handler.
	_runMiddleware(event) {
		const channel = this
		;(function run(middleware) {
			// Define `next` function to be called by middleware when complete
			let nextCalled = false
			const next = function (err) {
				// Ensure `next` is called exactly once
				if (nextCalled) {
					return
				}
				nextCalled = true

				if (err) {
					// Send request rejection if needed
					if (event.requestID >= 0) {
						channel._wrapper._sendReject(event.requestID, err)
					}
					// In this case, the message will never reach its event
					// handler
					channel._wrapper._debug(`channel: Event '${event.name}' dropped`)
				} else {
					// Run remaining middleware functions
					run(middleware.slice(1))
				}
			}

			const [fn] = middleware
			if (fn) {
				// Run the next middleware function `fn`
				try {
					fn(event.name, event.args, next)
				} catch (err) {
					// Middleware should've called `next(err)` instead of
					// throwing, but it's all good.
					next(err)
				}
			} else if (channel._emitter.emit(event.name, event)) {
				// No middleware remaining, so pass along to event handler
				channel._wrapper._debug(
					`channel: Event '${event.name}' sent to event listener`
				)
			} else {
				// `emit` returned `false` indicating there was no event handler
				// for this message.
				next(
					new Error(
						`No event listener for '${event.name}'` +
							(channel._name ? ` on channel '${channel._name}'` : "")
					)
				)
			}
		})(this._middleware)
	}

	_wrapEvent(eventName) {
		// Default channel should not wrap NO_WRAP_EVENTS
		return (
			this._name != null ||
			WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) < 0
		)
	}
	_wrapListener(listener) {
		if (typeof listener !== "function") {
			throw new TypeError("listener must be a function")
		}
		let wrapped = this._wrappedListeners.get(listener)
		if (!wrapped) {
			wrapped = function channelListenerWrapper({
				name, // event name
				args, // arguments to event handler
				requestID: reqID, // request ID
				requestSignal: reqSig, // request cancellation signal
			}) {
				/* This function is called when an event is emitted on this
					WebSocketChannel's `_emitter` when the WebSocketWrapper
					receives an incoming message for this channel.  If this
					event is a request, special processing is needed to
					send the response back over the socket.  Below we use
					the return value from the original `listener` to
					determine what response should be sent back.

					`this` refers to the WebSocketChannel instance
				*/
				const wrapper = this._wrapper
				let context = this
				let anonChan = null
				let reqDone = () => {} // no-op by default
				if (reqID >= 0 && reqSig) {
					// Create a per-request context that inherits from the
					// channel but has its own signal and channel factory
					context = Object.create(this)
					context.signal = reqSig
					// Note: Anonymous channels are not allowed unless
					// AbortController is available to the runtime
					context.channel = () => {
						// Store anonymous channel in `anonChan` to allow this
						// function to be called multiple times
						if (!anonChan) {
							anonChan = new WebSocketChannel(String(reqID), wrapper)
							anonChan._isAnonymous = true
							// If the request is cancelled remotely, we close
							// the channel
							anonChan._requestSignal = reqSig
							anonChan._onRequestAbort = () => anonChan.close()
							reqSig.addEventListener("abort", anonChan._onRequestAbort, {
								once: true,
							})
						}
						return anonChan
					}
					reqDone = () => {
						// Clean up active request tracking
						wrapper._activeRequests.delete(reqID)
					}
				}

				let returnVal
				try {
					returnVal = listener.apply(context, args)
				} catch (err) {
					if (reqID >= 0) {
						/* If event listener throws, pass that Error back
							as a response to the request */
						wrapper._sendReject(reqID, err)
					}
					reqDone()
					// Re-throw
					throw err
				}
				if (returnVal instanceof Promise) {
					/* If event listener returns a Promise, respond once
						the Promise resolves */
					returnVal
						.then((data) => {
							if (reqID >= 0) {
								if (data === anonChan) {
									// Handler returned an anonymous channel
									// Register the anonymous channel
									// (marks it as "open")
									wrapper._anonymousChannels.set(reqID, data)
									// Send response
									wrapper._sendResolveAnon(reqID)
								} else {
									wrapper._sendResolve(reqID, data)
								}
							}
						})
						.catch((err) => {
							if (reqID >= 0) {
								wrapper._sendReject(reqID, err)
							}
							// else silently ignore error
						})
						.then(reqDone)
				} else if (returnVal === anonChan) {
					// Handler returned an anonymous channel
					// Register the anonymous channel
					// (marks it as "open")
					wrapper._anonymousChannels.set(reqID, returnVal)
					// Send response
					wrapper._sendResolveAnon(reqID)
					reqDone()
				} else if (reqID >= 0) {
					wrapper._sendResolve(reqID, returnVal)
					reqDone()
				}
				// else return value is ignored for simple events
			}.bind(this) // Bind the channel to the `channelListenerWrapper`
			// Add a reference back to the original listener
			wrapped._original = listener
			this._wrappedListeners.set(listener, wrapped)
		}
		// Finally, return the wrapped listener
		return wrapped
	}

	get(key) {
		return this._wrapper.get(key)
	}

	set(key, value) {
		this._wrapper.set(key, value)
		return this
	}
}

// Add aliases to existing methods
WebSocketChannel.prototype.addListener = WebSocketChannel.prototype.on
WebSocketChannel.prototype.off = WebSocketChannel.prototype.removeListener

// List of "special" reserved events whose listeners don't need to be wrapped
WebSocketChannel.NO_WRAP_EVENTS = [
	"open",
	"connect",
	"message",
	"error",
	"close",
	"disconnect",
]

// Expose the class
export default WebSocketChannel
