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
		this.name = name;
		this._wrapper = socketWrapper;
		this._emitter = new EventEmitter();
	}

	/* Expose EventEmitter-like API
		When `eventName` is one of the `NO_WRAP_EVENTS`, the event handlers
		are left untouched, and the emitted events are just sent to the
		EventEmitter; otherwise, event listeners are wrapped to process the
		incoming request and the emitted events are sent to the WebSocketWrapper
		to be serialized and sent over the WebSocket. */

	on(eventName, listener) {
		if(this.name == null && WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0)
			return this._emitter.on(eventName, listener);
		else
			return this._emitter.on(eventName, this._wrapListener(listener) );
	}

	once(eventName, listener) {
		if(this.name == null && WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0)
			return this._emitter.once(eventName, listener);
		else
			return this._emitter.once(eventName, this._wrapListener(listener) );
	}

	removeListener(eventName, listener) {
		if(this.name == null && WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0)
			return this._emitter.removeListener(eventName, listener);
		else
			return this._emitter.removeListener(eventName, listener._wrapper);
	}

	removeAllListeners(eventName) {
		return this._emitter.removeAllListeners(eventName);
	}

	eventNames() {
		return this._emitter.eventNames();
	}

	listeners(eventName) {
		if(this.name == null && WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0)
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
		if(this.name == null && WebSocketChannel.NO_WRAP_EVENTS.indexOf(eventName) >= 0)
			return this._emitter.emit.apply(this._emitter, arguments);
		else
			return this._wrapper._sendEvent(this.name, eventName, arguments);
	}

	request(eventName) {
		return this._wrapper._sendEvent(this.name, eventName, arguments, true);
	}

	_wrapListener(listener) {
		// Create `listener._wrapper` if it doesn't exist yet
		if(typeof listener._wrapper !== "function") {
			Object.defineProperty(listener, "_wrapper", {
				"enumerable": false,
				"value": function channelListenerWrapper(event) {
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
						// else we silently ignore the error for simple events
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
				}.bind(this) // Bind the channel to the `channelListenerWrapper`
			});
			// Add a reference back to the original listener
			listener._wrapper._original = listener;
		}
		// Finally, return the wrapped listener
		return listener._wrapper;
	}
}

// Add aliases to existing methods
WebSocketChannel.prototype.addListener = WebSocketChannel.prototype.on;
WebSocketChannel.prototype.off = WebSocketChannel.prototype.removeListener;

// List of "special" reserved events whose listeners don't need to be wrapped
WebSocketChannel.NO_WRAP_EVENTS = ["open", "message", "error", "close", "disconnect"];

// Expose the class
module.exports = WebSocketChannel;
