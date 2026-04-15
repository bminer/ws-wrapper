import WebSocketChannel from "./channel.mjs"

/**
 * Error thrown when a request times out.
 */
class RequestTimeoutError extends Error {
	constructor() {
		super("Request timed out")
		this.name = "RequestTimeoutError"
	}
}

/**
 * Error thrown when a request is aborted via AbortSignal.
 */
class RequestAbortedError extends Error {
	constructor(reason) {
		super("Request aborted")
		this.name = "RequestAbortedError"
		this.reason = reason
	}
}

/**
 * WebSocketWrapper provides socket.io-like event handling, Promise-based requests,
 * and channels for WebSocket connections with support for request cancellation.
 * @extends WebSocketChannel
 */
class WebSocketWrapper extends WebSocketChannel {
	/**
	 * Creates a new WebSocketWrapper instance.
	 * @param {WebSocket} socket - The native WebSocket instance to wrap
	 * @param {Object} [options] - Configuration options
	 * @param {boolean|Function} [options.debug] - Enable debug logging or provide custom debug function
	 * @param {Function} [options.errorToJSON] - Custom error serialization function
	 * @param {number} [options.requestTimeout] - Default timeout in milliseconds for requests
	 */
	constructor(socket, options) {
		// Make `this` a WebSocketChannel
		super()
		// The `_wrapper` for the WebSocketChannel is itself
		this._wrapper = this
		// Populate options
		options = options || {}
		if (typeof options.debug === "function") {
			this._debug = options.debug
		} else if (options.debug === true) {
			this._debug = console.log.bind(console)
		} else {
			this._debug = () => {} // no-op
		}
		if (typeof options.errorToJSON === "function") {
			this._errorToJSON = options.errorToJSON
		} else {
			// Default error serialization.  In Node.js only the message is
			// included to avoid leaking server-side stack traces to clients.
			// In the browser all own properties are serialized so that custom
			// error fields are preserved on the receiving end.
			this._errorToJSON = (err) => {
				if (typeof window === "undefined") {
					return JSON.stringify({ message: err.message })
				} else {
					return JSON.stringify(err, Object.getOwnPropertyNames(err))
				}
			}
		}
		if (options.requestTimeout > 0) {
			this._requestTimeout = Math.floor(Number(options.requestTimeout))
		}

		// Flag set once the socket is opened
		this._opened = false
		// Array of data to be sent once the connection is opened
		this._pendingSend = []
		// Incrementing outbound request ID counter for this WebSocket
		this._lastRequestId = 0
		/* Object of pending outbound requests; keys are the request ID, values
			are Objects containing the following keys:
			- `resolve` - resolves the request's Promise
			- `reject` - rejects the request's Promise
			- `finalize` - function to be called once to clean up the request
				(i.e. abort listener and timer); accepts an optional anonymous
				channel to transfer request signal before cleaning up
		*/
		this._pendingRequests = {}
		/* Object of active inbound requests being processed; keys are the
			remote's request ID, values are AbortController instances that can
			be used to cancel the request processing. */
		this._activeRequests = {}
		/* Object of WebSocketChannels (except `this` associated with this
			WebSocket); keys are the channel name. */
		this._channels = {}
		/* Object of anonymous (request-scoped) WebSocketChannels; keys are
			the requestor's request ID. Separate from _channels to avoid
			collisions. */
		this._anonymousChannels = {}
		// Object containing user-assigned socket data
		this._data = {}
		// Bind this wrapper to the `socket` passed to the constructor
		this._socket = null
		if (socket && socket.constructor) {
			this.bind(socket)
		}
	}

	/**
	 * Bind this wrapper to a new WebSocket instance.
	 * @param {WebSocket} socket - The new WebSocket to bind
	 * @returns {WebSocketWrapper} This wrapper for chaining
	 */
	bind(socket) {
		if (
			!socket ||
			typeof socket.send !== "function" ||
			typeof socket.close !== "function"
		) {
			throw new TypeError("socket must be a WebSocket-like object")
		}
		// Clean up any event handlers on `this._socket`
		if (this._socket) {
			const s = this._socket
			s.onopen = s.onmessage = s.onerror = s.onclose = null
		}
		// Save the `socket` and add event listeners
		this._socket = socket
		socket.onopen = (event) => {
			this._opened = true
			this._debug("socket: onopen")
			// Send all pending messages in FIFO order. On send failure, keep
			// the failed message and all remaining messages in the queue
			// (preserving order) and re-throw so the caller knows about it.
			let i
			for (i = 0; i < this._pendingSend.length; i++) {
				if (this.isConnected) {
					this._debug("wrapper: Sending pending message:", this._pendingSend[i])
					try {
						this._socket.send(this._pendingSend[i])
					} catch (e) {
						this._pendingSend = this._pendingSend.slice(i)
						throw e
					}
				} else {
					break
				}
			}
			this._pendingSend = this._pendingSend.slice(i)
			this.emit("open", event)
			this.emit("connect", event)
		}
		socket.onmessage = (event) => {
			this._debug("socket: onmessage", event.data)
			this.emit("message", event, event.data)
			this._onMessage(event.data)
		}
		socket.onerror = (event) => {
			this._debug("socket: onerror", event)
			this.emit("error", event)
		}
		socket.onclose = (event) => {
			const opened = this._opened
			this._opened = false
			this._debug("socket: onclose", event)
			this.emit("close", event, opened)
			this.emit("disconnect", event, opened)
		}
		// If the socket is already open, send all pending messages now
		if (this.isConnected) {
			socket.onopen()
		}
		return this
	}

	/**
	 * Bound WebSocket instance.
	 * @type {WebSocket}
	 */
	get socket() {
		return this._socket
	}

	set socket(socket) {
		this.bind(socket)
	}

	/**
	 * Reject all pending outbound requests and clear the pending send queue.
	 * Useful when tearing down a connection and you want immediate rejection
	 * rather than waiting for timeouts.
	 * @returns {WebSocketWrapper} This wrapper for chaining
	 */
	abort() {
		for (const id in this._pendingRequests) {
			const pendReq = this._pendingRequests[id]
			pendReq.finalize() // clean up abort listener and timer
			pendReq.reject(new RequestAbortedError())
		}
		this._pendingRequests = {}
		this._pendingSend = []
		return this
	}

	/**
	 * Get a channel with the specified namespace.
	 * @param {string} namespace - The channel namespace
	 * @returns {WebSocketChannel} The channel instance
	 */
	of(namespace) {
		const chans = this._channels
		if (namespace == null) {
			return this
		}
		if (!chans[namespace]) {
			chans[namespace] = new WebSocketChannel(namespace, this)
		}
		return chans[namespace]
	}

	/**
	 * Get the count of pending outbound requests.
	 * @returns {number} Number of pending requests
	 */
	get pendingRequestCount() {
		return Object.keys(this._pendingRequests).length
	}

	/**
	 * Get the count of active inbound requests being processed.
	 * @returns {number} Number of active requests
	 */
	get activeRequestCount() {
		return Object.keys(this._activeRequests).length
	}

	/**
	 * True while the underlying socket is in the CONNECTING state.
	 * @type {boolean}
	 */
	get isConnecting() {
		return !!(
			this._socket &&
			this._socket.readyState === this._socket.constructor.CONNECTING
		)
	}

	/**
	 * True when the underlying socket is open and ready to send.
	 * @type {boolean}
	 */
	get isConnected() {
		return !!(
			this._socket && this._socket.readyState === this._socket.constructor.OPEN
		)
	}

	/**
	 * Send raw data over the WebSocket. If the socket is not yet connected the
	 * data is queued and sent once the connection opens.
	 * @param {string} data - Serialized data to send
	 * @param {boolean} [ignoreMaxQueueSize=false] - Bypass the queue size limit
	 * @returns {WebSocketWrapper} This wrapper for chaining
	 */
	send(data, ignoreMaxQueueSize) {
		if (this.isConnected) {
			this._debug("wrapper: Sending message:", data)
			this._socket.send(data)
		} else if (
			ignoreMaxQueueSize ||
			this._pendingSend.length < WebSocketWrapper.MAX_SEND_QUEUE_SIZE
		) {
			this._debug("wrapper: Queuing message:", data)
			this._pendingSend.push(data)
		} else {
			throw new Error("WebSocket is not connected and send queue is full")
		}
		return this
	}

	/**
	 * Close the underlying WebSocket. All arguments are forwarded to
	 * `WebSocket.close()` (e.g. a close code and reason string).
	 * @returns {WebSocketWrapper} This wrapper for chaining
	 */
	disconnect() {
		if (this._socket) {
			this._socket.close.apply(this._socket, arguments)
		}
		return this
	}

	/**
	 * Closes the underlying WebSocket by delegating to {@link disconnect}.
	 * Overrides `WebSocketChannel.close()` so that calling `close()` on the
	 * root wrapper does not accidentally remove channel listeners.
	 * @returns {WebSocketWrapper} This wrapper for chaining
	 */
	close() {
		return this.disconnect.apply(this, arguments)
	}

	// Called whenever the bound Socket receives a message
	_onMessage(msg) {
		const {
			_activeRequests: activeReqs,
			_pendingRequests: pendingReqs,
			_anonymousChannels: anonChans,
		} = this
		try {
			msg = JSON.parse(msg)
			// If `msg` contains special ignore property, we'll ignore it
			if (msg["ws-wrapper"] === false) {
				return
			}
			if (msg.a) {
				msg.a = Array.from(msg.a)
			}
			if (typeof msg.i !== "number") {
				msg.i = -1
			}
			/* If `msg` does not have an `a` Array with at least 1 element,
				ignore the message because it is not a valid event/request */
			if (
				msg.a instanceof Array &&
				msg.a.length >= 1 &&
				(msg.c ||
					msg.h ||
					WebSocketChannel.NO_WRAP_EVENTS.indexOf(msg.a[0]) < 0)
			) {
				// Process inbound event/request
				const event = {
					name: msg.a.shift(),
					args: msg.a,
					requestID: msg.i,
				}

				// Find the channel
				let channel = this
				if (msg.h != null) {
					channel = anonChans[msg.h]
				} else if (msg.c != null) {
					channel = this._channels[msg.c]
				}
				if (!channel) {
					if (msg.h != null) {
						// Fail-safe: notify the remote to stop emitting on the
						// closed channel
						const err = new Error(`Anonymous channel '${msg.h}' does not exist`)
						this._sendCancelAnon(msg.h, err)
						if (msg.i >= 0) {
							this._sendReject(msg.i, err)
						}
					} else if (msg.i >= 0) {
						this._sendReject(
							msg.i,
							new Error(`Channel '${msg.c}' does not exist`)
						)
					}
					this._debug(
						`wrapper: Event '${event.name}' ignored because ${
							msg.h != null
								? `anonymous channel '${msg.h}'`
								: `channel '${msg.c}'`
						} does not exist.`
					)
				} else {
					// Create AbortController for incoming request if the runtime
					// supports it
					if (msg.i >= 0 && typeof AbortController === "function") {
						const ac = new AbortController()
						activeReqs[msg.i] = ac
						event.requestSignal = ac.signal
					}

					// Process the message through middleware and event handlers
					channel._runMiddleware(event)
				}
			} else if (msg.x !== undefined && msg.h == null && activeReqs[msg.i]) {
				this._debug("wrapper: Processing cancellation for request", msg.i)
				// Reconstruct the reason from msg.x / msg._
				let reason = msg.x
				if (msg._ && reason) {
					reason = new Error(reason.message)
					for (const key in msg.x) {
						reason[key] = msg.x[key]
					}
				}
				// Process cancellation to prior request
				const abortController = activeReqs[msg.i]
				delete activeReqs[msg.i]
				abortController.abort(reason)
			} else if (msg.x !== undefined && msg.h != null) {
				this._debug(
					"wrapper: Processing anonymous channel abort for channel",
					msg.h
				)
				// Reconstruct the reason from msg.x / msg._
				let reason = msg.x
				if (msg._ && reason) {
					reason = new Error(reason.message)
					for (const key in msg.x) {
						reason[key] = msg.x[key]
					}
				}
				// Close the anonymous channel locally, forwarding the reason so
				// that `closeSignal.reason` reflects the actual abort reason
				const anonChan = anonChans[String(msg.h)]
				if (anonChan) anonChan.close(reason)
			} else if (pendingReqs[msg.i]) {
				this._debug("wrapper: Processing response for request", msg.i)
				// Process response to prior request
				const pendReq = pendingReqs[msg.i]
				delete pendingReqs[msg.i]
				if (msg.e !== undefined) {
					let err = msg.e
					// `msg._` indicates that `msg.e` is a serialized Error object
					if (msg._ && err) {
						err = new Error(err.message)
						// Copy other properties to Error
						for (const key in msg.e) {
							err[key] = msg.e[key]
						}
					}
					pendReq.finalize()
					pendReq.reject(err)
				} else if (msg.h != null) {
					// Anonymous channel creation response
					const chan = new WebSocketChannel(String(msg.i), this)
					chan._isAnonymous = true
					// finalize transfers signal/timeout to chan, then cleans up
					pendReq.finalize(chan)
					anonChans[String(msg.i)] = chan
					pendReq.resolve(chan)
				} else {
					pendReq.finalize()
					pendReq.resolve(msg.d)
				}
			}
			// else ignore the message because it's not valid or irrelevant
		} catch (ignoreErr) {
			// Non-JSON messages are silently ignored; uncaught exceptions from
			// event handlers may also end up here.
		}
	}

	/* The following methods are called by a WebSocketChannel to send data
		to the Socket. Note: `args` is the `arguments` object from the calling
		method and already contains the event name as its first element. */
	_sendEvent(
		channel,
		_eventName,
		args,
		{ isRequest, signal, requestTimeout, isAnonymous }
	) {
		// Serialize data for sending over the socket
		const data = { a: Array.prototype.slice.call(args) }
		if (channel != null) {
			if (isAnonymous) {
				data.h = channel
			} else {
				data.c = channel
			}
		}
		let request
		if (isRequest) {
			if (signal && signal.aborted) {
				// Signal already aborted, so don't bother sending the request.
				return Promise.reject(new RequestAbortedError(signal.reason))
			}
			/* Unless we send petabytes of data using the same socket,
				we won't worry about `_lastRequestId` getting too big. */
			data.i = ++this._lastRequestId
			// Return a Promise to the caller to be resolved later
			request = new Promise((resolve, reject) => {
				const onAbort = () => {
					// Send cancellation message and immediately reject
					this._sendCancel(data.i, signal.reason)
					reject(new RequestAbortedError(signal.reason))
					finalize()
					delete this._pendingRequests[data.i]
				}
				const onTimeout = () => {
					// Send cancellation message and immediately reject
					this._sendCancel(data.i)
					reject(new RequestTimeoutError())
					finalize()
					delete this._pendingRequests[data.i]
				}
				// Set up AbortSignal handling if provided
				if (signal) {
					signal.addEventListener("abort", onAbort)
				}
				// Set up timer; use provided timeout or wrapper default
				const timeoutMs =
					requestTimeout !== undefined ? requestTimeout : this._requestTimeout
				const timer = timeoutMs > 0 && setTimeout(onTimeout, timeoutMs)
				const finalize = (anonChan) => {
					// Clean up abort listener and timer
					if (signal) {
						signal.removeEventListener("abort", onAbort)
						// If an anonymous channel is provided, transfer abort
						// signal
						if (anonChan) {
							anonChan._requestSignal = signal
							signal.addEventListener("abort", anonChan._onRequestAbort, {
								once: true,
							})
						}
					}
					clearTimeout(timer)
				}
				this._pendingRequests[data.i] = {
					resolve,
					reject,
					finalize,
				}
			})
		}
		// Send the message
		this.send(JSON.stringify(data))
		// Return the request, if needed
		return request
	}

	_sendResolve(id, data) {
		this.send(
			JSON.stringify({
				i: id,
				d: data,
			}),
			true /* ignore max queue length */
		)
	}

	_sendReject(id, err) {
		if (err == null) {
			// null and undefined can't be reliably round-tripped over JSON
			// (undefined is omitted entirely; null is indistinguishable from
			// absent in some runtimes like Go). Use a default Error instead.
			err = new Error("Error")
		}
		const isError = err instanceof Error
		if (isError) {
			err = JSON.parse(this._errorToJSON(err))
		}
		this.send(
			JSON.stringify({
				i: id,
				e: err,
				_: isError ? 1 : undefined,
			}),
			true /* ignore max queue length */
		)
	}

	_sendCancel(id, reason) {
		if (reason == null) {
			// No reason provided; send a default RequestAbortedError.
			reason = new RequestAbortedError()
		}
		const isError = reason instanceof Error
		if (isError) {
			reason = JSON.parse(this._errorToJSON(reason))
		}
		this.send(
			JSON.stringify({
				i: id,
				x: reason,
				_: isError ? 1 : undefined,
			}),
			true /* ignore max queue length */
		)
	}

	_sendCancelAnon(chan, reason) {
		if (reason == null) {
			reason = new RequestAbortedError()
		}
		const isError = reason instanceof Error
		if (isError) {
			reason = JSON.parse(this._errorToJSON(reason))
		}
		this.send(
			JSON.stringify({
				h: chan,
				x: reason,
				_: isError ? 1 : undefined,
			}),
			true /* ignore max queue length */
		)
	}

	_sendResolveAnon(requestID) {
		this.send(
			JSON.stringify({
				i: requestID,
				h: 1,
			}),
			true /* ignore max queue length */
		)
	}

	get(key) {
		return this._data[key]
	}

	set(key, value) {
		this._data[key] = value
		return this
	}
}

/* Maximum number of items in the send queue. If a user tries to send more
	messages than this number while a WebSocket is not connected, errors will
	be thrown. */
WebSocketWrapper.MAX_SEND_QUEUE_SIZE = 10

// Export error classes for user convenience
WebSocketWrapper.RequestTimeoutError = RequestTimeoutError
WebSocketWrapper.RequestAbortedError = RequestAbortedError

export default WebSocketWrapper
export { RequestAbortedError, RequestTimeoutError }
