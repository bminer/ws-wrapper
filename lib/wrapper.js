"use strict";
const WebSocketChannel = require("./channel");

class WebSocketWrapper extends WebSocketChannel {
	constructor(socket, options) {
		// Make `this` a WebSocketChannel
		super();
		this._wrapper = this;
		options = options || {};
		if(typeof options.debug === "function") {
			this._debug = options.debug;
		} else if(options.debug === true) {
			this._debug = console.log.bind(console);
		} else {
			this._debug = () => {}; // no-op
		}
		if(typeof options.errorToJSON !== "function") {
			// Provide default error serialization
			this._errorToJSON = (err) => {
				if(typeof window === "undefined") {
					// Node.js environment only serializes `message`
					return JSON.stringify({"message": err.message});
				} else {
					// Browser serializes all error properties
					return JSON.stringify(err,
						Object.getOwnPropertyNames(err) );
				}
			};
		} else {
			this._errorToJSON = options.errorToJSON;
		}
		if(options.requestTimeout > 0)
			this._requestTimeout = options.requestTimeout | 0;

		// Flag set once the socket is opened
		this._opened = false;
		// Array of data to be sent once the connection is opened
		this._pendingSend = [];
		// Incrementing request ID counter for this WebSocket
		this._lastRequestId = 0;
		/* Object of pending requests; keys are the request ID, values are
			Objects containing `resolve` and `reject` functions used to
			resolve the request's Promise. */
		this._pendingRequests = {};
		/* Object of WebSocketChannels (except `this` associated with this
			WebSocket); keys are the channel name. */
		this._channels = {};
		// Object containing user-assigned socket data
		this._data = {};
		// Bind this wrapper to the `socket` passed to the constructor
		this._socket = null;
		if(socket && socket.constructor) {
			this.bind(socket);
		}
	}

	bind(socket) {
		// Clean up any event handlers on `this._socket`
		if(this._socket) {
			var s = this._socket;
			s.onopen = s.onmessage = s.onerror = s.onclose = null;
		}
		// Save the `socket` and add event listeners
		this._socket = socket;
		socket.onopen = (event) => {
			this._opened = true;
			this._debug("socket: onopen");
			// Send all pending messages
			for(var i = 0; i < this._pendingSend.length; i++) {
				if(this.isConnected) {
					this._debug("wrapper: Sending pending message:",
						this._pendingSend[i]);
					try {
						this._socket.send(this._pendingSend[i]);
					} catch(e) {
						this._pendingSend = this._pendingSend.slice(i - 1);
						throw e;
					}
				} else {
					break;
				}
			}
			this._pendingSend = this._pendingSend.slice(i);
			this.emit("open", event);
		};
		socket.onmessage = (event) => {
			this._debug("socket: onmessage", event.data);
			this.emit("message", event, event.data);
			this._onMessage(event.data);
		};
		socket.onerror = (event) => {
			this._debug("socket: onerror", event);
			this.emit("error", event);
		};
		socket.onclose = (event) => {
			var opened = this._opened;
			this._opened = false;
			this._debug("socket: onclose", event);
			this.emit("close", event, opened);
			this.emit("disconnect", event, opened);
		};
		// If the socket is already open, send all pending messages now
		if(this.isConnected) {
			socket.onopen();
		}
		return this;
	}

	get socket() {
		return this._socket;
	}

	set socket(socket) {
		this.bind(socket);
	}

	// Rejects all pending requests and then clears the send queue
	abort() {
		for(var id in this._pendingRequests) {
			this._pendingRequests[id].reject(new Error("Request was aborted") );
		}
		this._pendingRequests = {};
		this._pendingSend = [];
		return this;
	}

	// Returns a channel with the specified `namespace`
	of(namespace) {
		if(namespace == null) {
			return this;
		}
		if(!this._channels[namespace]) {
			this._channels[namespace] = new WebSocketChannel(namespace, this);
		}
		return this._channels[namespace];
	}

	get isConnecting() {
		return this._socket && this._socket.readyState ===
			this._socket.constructor.CONNECTING;
	}

	get isConnected() {
		return this._socket && this._socket.readyState ===
			this._socket.constructor.OPEN;
	}

	send(data, ignoreMaxQueueSize) {
		if(this.isConnected) {
			this._debug("wrapper: Sending message:", data);
			this._socket.send(data);
		} else if(ignoreMaxQueueSize ||
			this._pendingSend.length < WebSocketWrapper.MAX_SEND_QUEUE_SIZE)
		{
			this._debug("wrapper: Queuing message:", data);
			this._pendingSend.push(data);
		} else {
			throw new Error("WebSocket is not connected and send queue is full");
		}
		return this;
	}

	disconnect() {
		if(this._socket)
			this._socket.close.apply(this._socket, arguments);
		return this;
	}

	// Called whenever the bound Socket receives a message
	_onMessage(msg) {
		try {
			msg = JSON.parse(msg);
			// If `msg` contains special ignore property, we'll ignore it
			if(msg["ws-wrapper"] === false)
				return;
			if(msg.a) {
				var argsArray = [];
				for(var i in msg.a) {
					argsArray[i] = msg.a[i];
				}
				msg.a = argsArray;
			}
			/* If `msg` does not have an `a` Array with at least 1 element,
				ignore the message because it is not a valid event/request */
			if(msg.a instanceof Array && msg.a.length >= 1 &&
				(msg.c || WebSocketChannel.NO_WRAP_EVENTS.indexOf(msg.a[0]) < 0) )
			{
				// Process inbound event/request
				var event = {
					"name": msg.a.shift(),
					"args": msg.a,
					"requestId": msg.i
				};
				var channel = msg.c == null ? this : this._channels[msg.c];
				if(!channel) {
					if(msg.i >= 0) {
						this._sendReject(msg.i, new Error(
							`Channel '${msg.c}' does not exist`
						) );
					}
					this._debug(`wrapper: Event '${event.name}' ignored ` +
							`because channel '${msg.c}' does not exist.`);
				} else if(channel._emitter.emit(event.name, event) ) {
					this._debug(`wrapper: Event '${event.name}' sent to ` +
						"event listener");
				} else {
					if(msg.i >= 0) {
						this._sendReject(msg.i, new Error(
							"No event listener for '" + event.name + "'" +
							(msg.c ? " on channel '" + msg.c + "'" : "")
						) );
					}
					this._debug(`wrapper: Event '${event.name}' had no ` +
						"event listener");
				}
			} else if(this._pendingRequests[msg.i]) {
				this._debug("wrapper: Processing response for request", msg.i);
				// Process response to prior request
				if(msg.e !== undefined) {
					var err = msg.e;
					// `msg._` indicates that `msg.e` is an Error
					if(msg._ && err) {
						err = new Error(err.message);
						// Copy other properties to Error
						for(var key in msg.e) {
							err[key] = msg.e[key];
						}
					}
					this._pendingRequests[msg.i].reject(err);
				} else {
					this._pendingRequests[msg.i].resolve(msg.d);
				}
				clearTimeout(this._pendingRequests[msg.i].timer);
				delete this._pendingRequests[msg.i];
			}
			// else ignore the message because it's not valid
		} catch(e) {
			// Non-JSON messages are ignored
			/* Note: It's also possible for uncaught exceptions from event
				handlers to end up here. */
		}
	}

	/* The following methods are called by a WebSocketChannel to send data
		to the Socket. */
	_sendEvent(channel, eventName, args, isRequest) {
		// Serialize data for sending over the socket
		var data = {"a": args};
		if(channel != null) {
			data.c = channel;
		}
		var request;
		if(isRequest) {
			/* Unless we send petabytes of data using the same socket,
				we won't worry about `_lastRequestId` getting too big. */
			data.i = ++this._lastRequestId;
			// Return a Promise to the caller to be resolved later
			request = new Promise((resolve, reject) => {
				var pendReq = this._pendingRequests[data.i] = {
					"resolve": resolve,
					"reject": reject
				};
				if(this._requestTimeout > 0) {
					pendReq.timer = setTimeout(() => {
						reject(new Error("Request timed out") );
						delete this._pendingRequests[data.i];
					}, this._requestTimeout);
				}
			});
		}
		// Send the message
		this.send(JSON.stringify(data) );
		// Return the request, if needed
		return request;
	}

	_sendResolve(id, data) {
		this.send(JSON.stringify({
			"i": id,
			"d": data
		}), true /* ignore max queue length */);
	}

	_sendReject(id, err) {
		var isError = err instanceof Error;
		if(isError) {
			err = JSON.parse(this._errorToJSON(err) );
		}
		this.send(JSON.stringify({
			"i": id,
			"e": err,
			"_": isError ? 1 : undefined
		}), true /* ignore max queue length */);
	}

	get(key) {
		return this._data[key];
	}

	set(key, value) {
		this._data[key] = value;
		return this;
	}
}

/* Maximum number of items in the send queue.  If a user tries to send more
	messages than this number while a WebSocket is not connected, errors will
	be thrown. */
WebSocketWrapper.MAX_SEND_QUEUE_SIZE = 10;

module.exports = WebSocketWrapper;
