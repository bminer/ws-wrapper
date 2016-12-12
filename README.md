# ws-wrapper

Lightweight [Web Socket](https://en.wikipedia.org/wiki/WebSocket) lib with
socket.io-like event handling, Promise-based requests, and channels.

## Why?

Because lightweight is sometimes what you want.

This lib might be useful if you want some [socket.io](http://socket.io/docs/)
functionality (i.e. namespaces, event handling, etc.), but you don't want all
of the [engine.io](https://github.com/socketio/engine.io) transports.  When
using this library in conjunction with a library like
[ws](https://github.com/websockets/ws), your real-time web application can be
pretty darn lightweight without giving up some nice bare-bones functionality.

[ws](https://github.com/websockets/ws) +
[ws-wrapper](https://github.com/bminer/ws-wrapper) is a good combination for
mobile apps, desktop apps (i.e. electron), or other browser-targeted web
applications.

## Install

```
npm install ws-wrapper
```

## Usage

Client-side

```javascript
var socket = new WebSocketWrapper(new WebSocket(...) );
```

Server-side
```javascript
const WebSocketServer = require("ws").Server
	, WebSocketWrapper = require("ws-wrapper");
var wss = new WebSocketServer({port: 3000});
wss.on("connection", (socket) => {
	socket = new WebSocketWrapper(socket);
	// ...
});
```

## Event Handling

Call `on` or `once` to bind an event handler to the `wrapper` or to a channel.
Call `emit` to send an event.

Server-side Example:

```javascript
const WebSocketServer = require("ws").Server
	, WebSocketWrapper = require("ws-wrapper");
var wss = new WebSocketServer({port: 3000});
var sockets = [];
wss.on("connection", (socket) => {
	var socket = new WebSocketWrapper(socket);
	sockets.push(socket);
	socket.on("msg", function(from, msg) {
		// `this` refers to the WebSocketWrapper instance
		console.log(`Received message from ${from}: ${msg}`);
		// Relay message to all clients
		sockets.forEach((socket) => {
			socket.emit("msg", from, msg);
		});
	});
	socket.on("disconnect", () => {
		var idx = sockets.indexOf(socket);
		if(idx >= 0)
			sockets.splice(idx, 1);
	});
});
```

Client-side:

```javascript
// Assuming WebSocketWrapper is somehow available to this scope...
var socket = new WebSocketWrapper(
	new WebSocket("ws://" + location.host)
);
socket.on("msg", function(from, msg) {
	console.log(`Received message from ${from}: ${msg}`);
});
socket.emit("msg", "my_name", "This is a test message");
```

## Channels

Just like in socket.io, you can "namespace" your sockets using channels.
When sending messages to multiple channels, the same WebSocket connection is
still used, but the events are separated into the appropriate channels.

By default, calling `emit` directly on a WebSocketWrapper instance will send
the message to the "default" channel.  To send a message over a channel named
"foo", just call `socket.of("foo").emit("eventName", "yourData")`.

## Request / Response

Event handlers can return values or [Promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
to respond to requests.  The response is sent back to the remote end.

The example below shows the client requesting data from the server, but
ws-wrapper also allows servers to request data from the client.

Server-side:

```javascript
const fs = require("fs")
	, WebSocketServer = require("ws").Server
	, WebSocketWrapper = require("ws-wrapper");
var wss = new WebSocketServer({port: 3000});
var sockets = [];
wss.on("connection", (socket) => {
	var socket = new WebSocketWrapper(socket);
	sockets.push(socket);
	socket.on("userCount", () => {
		// Return value is sent back to the client
		return sockets.length;
	});
	socket.on("readFile", (path) => {
		// We can return a Promise that eventually resolves
		return new Promise((resolve, reject) => {
			// `path` should obviously be sanitized, but just go with it...
			fs.readFile(path, (err, data) => {
				// `err` or `data` are now sent back to the client
				if(err)
					reject(err);
				else
					resolve(data.toString("utf8") );
			});
		});
	});
	socket.on("disconnect", () => {
		var idx = sockets.indexOf(socket);
		if(idx >= 0)
			sockets.splice(idx, 1);
	});
});
```

Client-side:

```javascript
// Assuming WebSocketWrapper is somehow available to this scope...
var socket = new WebSocketWrapper(
	new WebSocket("ws://" + location.host)
);
var p = socket.request("userCount");
// `p` is a Promise that will resolve when the server responds...
p.then((count) => {
	console.log("User count: " + count);
}).catch((err) => {
	console.error("An error occurred while getting the user count:", err);
});
socket.request("readFile", "/etc/issue").then((data) => {
	console.log("File contents:", data);
}).catch((err) => {
	console.error("Error reading file:", err);
});
```

## API

Class: WebSocketWrapper

A WebSocketWrapper simply wraps around a WebSocket to give you well-deserved
functionality. :)

`socket = new WebSocketWrapper(webSocketInstance);`

- Event: "error"
	- `event` - The Error event from the native WebSocket instance
- Event: "message"
	- `data` - The message data (same as `event.data`)
	- `event` - The Message event from the native WebSocket instance
- Event: "disconnect"
	- `event` - The Close event from the native WebSocket instance

The EventEmitter-like API looks like this:

- `socket.on(eventName, listener)`
	Adds the `listener` function to the end of the listeners array for the
	event named `eventName`.  When an event or request matching the
	`eventName` is received by the WebSocket, the `listener` is called.

	Values returned by the `listener` callback are used to respond to
	requests.  If the inbound message is a simple event (not a request), the
	return value of the `listener` is ignored.

	If the return value of the `listener` is a `Promise`, the response to
	the request will be sent once the Promise is resolved or rejected;
	otherwise, the return value of the `listener` is sent back to the remote
	end immediately.
- `socket.once(eventName, listener)`
	Adds a one time `listener` function for the event named `eventName`.
- `socket.removeListener(eventName, listener)`
	Removes the specified `listener` from the listener array for the event
	named `eventName`.
- `socket.removeAllListeners([eventName])`
	Removes all listeners, or those of the specified `eventName`.
- `socket.eventNames()`
	Returns an array listing the events for which the emitter has registered
	listeners.
- `socket.listeners(eventName)`
	Returns a copy of the array of listeners for the event named `eventName`.
- `socket.emit(eventName[, ...args])`
	Sends an event down the WebSocket with the specified `eventName` calling
	all listeners for `eventName` on the remote end, in the order they were
	registered, passing the supplied arguments to each.
- `socket.request(eventName[, ...args])`
	Sends a request down the WebSocket with the specified `eventName` and
	returns a [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
	that will resolve once the remote event listener responds.

	**Note**: While it is common design for only one event listener to exist on
	the remote end, all listeners for `eventName` on the remote end are called,
	in the order they were registered, passing the supplied arguments to each.
	Since Promises can only be resolved or rejected once, only the data from the
	first event listener is used to generate the response for this request.

	**Note**: If a request is sent, but there is no remote event listener to respond
	to the request, a response rejection is immediately sent back by the
	remote end.

Channel API:
 - `socket.of(channelName)`
 	Returns the channel with the specified `channelName`.  Every channel has the
 	same EventEmitter-like API as described above for sending and handling
 	channel-specific events and requests.


## Protocol

All data passed over the WebSocket should be valid JSON.  [ws-wrapper]
(https://github.com/bminer/ws-wrapper/) will parse the JSON string and determine
the message type based on the properties in the parsed Object.

The following message types are defined by ws-wrapper:

1. **Simple Event** - Identified by an Object with `a` key but no `i` key.
	The channel name is optional.

  ```javascript
	{
		"c": "channel_name",
		"a": ["event_name", "first_arg", "second_arg", "last_arg"]
	}
	```
	The client or server can send events.  Events are nothing more than an event
	name and some data, passed as arguments to the event handler.
1. **Request** - Identified by an Object with `a` and `i` keys where `i` refers
	to the unique request identifier.  The channel name is optional.

  ```javascript
	{
		"i": 123,
		"c": "channel_name",
		"a": ["event_name", "first_arg", "second_arg", "last_arg"]
	}
	```
	The client or server can send a Request, which is essentially an Event that
	needs some sort of server Response.
1. **Response (Resolution)** - Identified by an Object with `i` and `d` keys
	where `i` is the request identifier and `d` is the response data.

  ```javascript
	{
		"i": 123,
		"d": {"resolved": "data", "hello": "world"}
	}
	```
1. **Response (Rejection)** - Identified by an Object with `i` and `e` keys
	where `i` is the request identifier and `e` is the error message to be used
	when rejecting the response Promise.

  ```javascript
	{
		"i": 123,
		"e": "error message",
	}
	```

If the message received by the WebSocket is not valid JSON or if the parsed
Object does not match one of the above message types, then the message is
simply ignored by ws-wrapper.  Also if the JSON message contains a `ws-wrapper`
property with the value `false`, the message will be ignored.