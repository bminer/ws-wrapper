"use strict";
// TODO: Use native "events" module if in Node.js environment?
const EventEmitter = require("eventemitter3").EventEmitter;

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
		this._name = name;
		// Reference to WebSocketWrapper instance
		this._wrapper = socketWrapper;
		// This channel's EventEmitter
		this._emitter = new EventEmitter();
		// WeakMap of wrapped event listeners
		this._wrappedListeners = new WeakMap();
	}

	// Retrieve channel name
	get name() {
		return this._name;
	}

	// Changing the channel name after it's been created is a bad idea.
	set name(name) {
		throw new Error("Setting the channel name is not allowed");
	}

	/* Expose EventEmitter-like API
		When `eventName` is one of the `NO_WRAP_EVENTS`, the event handlers
		are left untouched, and the emitted events are just sent to the
		EventEmitter; otherwise, event listeners are wrapped to process the
		incoming request and the emitted events are sent to the WebSocketWrapper
		to be serialized and sent over the WebSocket. */

	on(eventName, listener) {
		if(this._name == null && WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0)
			/* Note: The following is equivalent to:
					`this._emitter.on(eventName, listener.bind(this));`
				But thanks to eventemitter3, the following is a touch faster. */
			this._emitter.on(eventName, listener, this);
		else
			this._emitter.on(eventName, this._wrapListener(listener) );
		return this;
	}

	once(eventName, listener) {
		if(this._name == null && WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0)
			this._emitter.once(eventName, listener, this);
		else
			this._emitter.once(eventName, this._wrapListener(listener) );
		return this;
	}

	removeListener(eventName, listener) {
		if(this._name == null && WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0)
			this._emitter.removeListener(eventName, listener);
		else
			this._emitter.removeListener(eventName,
				this._wrappedListeners.get(listener) );
		return this;
	}

	removeAllListeners(eventName) {
		this._emitter.removeAllListeners(eventName);
		return this;
	}

	eventNames() {
		return this._emitter.eventNames();
	}

	listeners(eventName) {
		if(this._name == null && WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0)
			return this._emitter.listeners(eventName);
		else {
			return this._emitter.listeners(eventName).map((wrapper) => {
				return wrapper._original;
			});
		}
	}

	/* The following `emit` and `request` methods will serialize and send the
		event over the WebSocket using the WebSocketWrapper. */
	emit(eventName) {
		if(this._name == null && WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0)
			return this._emitter.emit.apply(this._emitter, arguments);
		else
			return this._wrapper._sendEvent(this._name, eventName, arguments);
	}

	/* Temporarily set the request timeout for the next request. */
	timeout(tempTimeout) {
		this._tempTimeout = tempTimeout;
		return this;
	}

	request(eventName) {
		var oldTimeout = this._wrapper._requestTimeout;
		if(this._tempTimeout !== undefined) {
			this._wrapper._requestTimeout = this._tempTimeout;
			delete this._tempTimeout;
		}
		var ret = this._wrapper._sendEvent(this._name, eventName, arguments, true);
		this._wrapper._requestTimeout = oldTimeout;
		return ret;
	}

	_wrapListener(listener) {
		if(typeof listener !== "function") {
			throw new TypeError("\"listener\" argument must be a function");
		}
		var wrapped = this._wrappedListeners.get(listener);
		if(!wrapped) {
			wrapped = function channelListenerWrapper(event)
			{
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
				*/
				try {
					var returnVal = listener.apply(this, event.args);
				} catch(err) {
					if(event.requestId >= 0) {
						/* If event listener throws, pass that Error back
							as a response to the request */
						this._wrapper._sendReject(
							event.requestId, err);
					}
					// Re-throw
					throw err;
				}
				if(returnVal instanceof Promise) {
					/* If event listener returns a Promise, respond once
						the Promise resolves */
					returnVal
						.then((data) => {
							if(event.requestId >= 0) {
								this._wrapper._sendResolve(
									event.requestId, data);
							}
						})
						.catch((err) => {
							if(event.requestId >= 0) {
								this._wrapper._sendReject(
									event.requestId, err);
							}
							// else silently ignore error
						});
				} else if(event.requestId >= 0) {
					/* Otherwise, assume that the `returnVal` is what
						should be passed back as the response */
					this._wrapper._sendResolve(
						event.requestId, returnVal);
				}
				// else return value is ignored for simple events
			}.bind(this); // Bind the channel to the `channelListenerWrapper`
			// Add a reference back to the original listener
			wrapped._original = listener;
			this._wrappedListeners.set(listener, wrapped);
		}
		// Finally, return the wrapped listener
		return wrapped;
	}

	get(key) {
		return this._wrapper.get(key);
	}

	set(key, value) {
		this._wrapper.set(key, value);
		return this;
	}
}

// Add aliases to existing methods
WebSocketChannel.prototype.addListener = WebSocketChannel.prototype.on;
WebSocketChannel.prototype.off = WebSocketChannel.prototype.removeListener;

// List of "special" reserved events whose listeners don't need to be wrapped
WebSocketChannel.NO_WRAP_EVENTS = ["open", "message", "error", "close", "disconnect"];

// Expose the class
module.exports = WebSocketChannel;
