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
	}

	// Retrieve channel name
	get name() {
		return this._name
	}

	// Changing the channel name after it's been created is a bad idea.
	set name(name) {
		throw new Error("Setting the channel name is not allowed")
	}

	/* Expose EventEmitter-like API
		When `eventName` is one of the `NO_WRAP_EVENTS`, the event handlers
		are left untouched, and the emitted events are just sent to the
		EventEmitter; otherwise, event listeners are wrapped to process the
		incoming request and the emitted events are sent to the WebSocketWrapper
		to be serialized and sent over the WebSocket. */
	on(eventName, listener) {
		const e = this._emitter
		if (
			this._name == null &&
			WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0
		) {
			/* Note: The following is equivalent to:
					`this._emitter.on(eventName, listener.bind(this));`
				But thanks to eventemitter3, the following is a touch faster. */
			e.on(eventName, listener, this)
		} else {
			e.on(eventName, this._wrapListener(listener))
		}
		return this
	}

	once(eventName, listener) {
		const e = this._emitter
		if (
			this._name == null &&
			WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0
		) {
			e.once(eventName, listener, this)
		} else {
			e.once(eventName, this._wrapListener(listener))
		}
		return this
	}

	removeListener(eventName, listener) {
		const e = this._emitter
		if (
			this._name == null &&
			WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0
		) {
			e.removeListener(eventName, listener)
		} else {
			e.removeListener(eventName, this._wrappedListeners.get(listener))
		}
		return this
	}

	removeAllListeners(eventName) {
		this._emitter.removeAllListeners(eventName)
		return this
	}

	eventNames() {
		return this._emitter.eventNames()
	}

	listeners(eventName) {
		const e = this._emitter
		if (
			this._name == null &&
			WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0
		) {
			return e.listeners(eventName)
		} else {
			return e.listeners(eventName).map((wrapper) => wrapper._original)
		}
	}

	/* The following `emit` and `request` methods will serialize and send the
		event over the WebSocket using the WebSocketWrapper. */
	emit(eventName) {
		if (
			this._name == null &&
			WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0
		) {
			return this._emitter.emit.apply(this._emitter, arguments)
		} else {
			return this._wrapper._sendEvent(this._name, eventName, arguments, {
				isRequest: false,
			})
		}
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
		return this._wrapper._sendEvent(this._name, eventName, arguments, {
			isRequest: true,
			signal,
			requestTimeout,
		})
	}

	// Remove this channel from its wrapper and clean up all listeners and middleware
	close() {
		const chans = this._wrapper._channels
		if (this._name != null && chans[this._name] === this) {
			delete chans[this._name]
		}
		this._emitter.removeAllListeners()
		this._middleware = []
	}

	// Add middleware for this channel
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
					if (event.requestId >= 0) {
						channel._wrapper._sendReject(event.requestId, err)
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

	_wrapListener(listener) {
		if (typeof listener !== "function") {
			throw new TypeError("listener must be a function")
		}
		let wrapped = this._wrappedListeners.get(listener)
		if (!wrapped) {
			wrapped = function channelListenerWrapper(event) {
				/* This function is called when an event is emitted on this
					WebSocketChannel's `_emitter` when the WebSocketWrapper
					receives an incoming message for this channel.  If this
					event is a request, special processing is needed to
					send the response back over the socket.  Below we use
					the return value from the original `listener` to
					determine what response should be sent back.

					`this` refers to the WebSocketChannel instance
					`event` has the following properties:
					- `name`
					- `args`
					- `requestId`
					- `abortController` (for requests)
				*/

				// Create a ChannelRequest context that inherits from the channel
				// but has its own signal property to avoid race conditions
				let context = this
				if (event.abortController) {
					// Create an object that inherits from the channel but has its own signal
					context = Object.create(this)
					context.signal = event.abortController.signal
				}

				let returnVal
				try {
					returnVal = listener.apply(context, event.args)
				} catch (err) {
					if (event.requestId >= 0) {
						/* If event listener throws, pass that Error back
							as a response to the request */
						this._wrapper._sendReject(event.requestId, err)
						// Clean up active request tracking
						if (event.abortController) {
							delete this._wrapper._activeRequests[event.requestId]
						}
					}
					// Re-throw
					throw err
				}

				if (returnVal instanceof Promise) {
					/* If event listener returns a Promise, respond once
						the Promise resolves */
					returnVal
						.then((data) => {
							if (event.requestId >= 0) {
								this._wrapper._sendResolve(event.requestId, data)
								// Clean up active request tracking
								if (event.abortController) {
									delete this._wrapper._activeRequests[event.requestId]
								}
							}
						})
						.catch((err) => {
							if (event.requestId >= 0) {
								this._wrapper._sendReject(event.requestId, err)
								// Clean up active request tracking
								if (event.abortController) {
									delete this._wrapper._activeRequests[event.requestId]
								}
							}
							// else silently ignore error
						})
				} else {
					if (event.requestId >= 0) {
						/* Otherwise, assume that the `returnVal` is what
							should be passed back as the response */
						this._wrapper._sendResolve(event.requestId, returnVal)
						// Clean up active request tracking
						if (event.abortController) {
							delete this._wrapper._activeRequests[event.requestId]
						}
					}
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
