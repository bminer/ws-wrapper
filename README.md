# ws-wrapper

Lightweight [Web Socket](https://en.wikipedia.org/wiki/WebSocket) lib with
socket.io-like event handling, Promise-based requests, and channels.

## What?

Much like Socket.io, this library provides a protocol and API that sits on top
of native WebSockets. Rather than passing raw messages through the WebSocket
via [`WebSocket.send()`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket#send()),
this library allows you to pass JSON data over the sockets and trigger event
handlers on the remote end. There is also a Promise-based request/response API,
as well.

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

WebSocketWrapper is a CommonJS module, so it works in Node.js and in the
browser if you use a tool like [browserify](http://browserify.org/) or
[module-concat](https://github.com/bminer/module-concat).

Check out the [example-app](https://github.com/bminer/ws-wrapper/tree/master/example-app)
for a sample chat application.

Note: This module uses ES6 classes.  If you need this to work in IE or another
old, decrepit browser, try using a code transpiler like
[Babel](https://babeljs.io/).

Client-side

```javascript
// Assuming WebSocketWrapper is available to this scope...
var socket = new WebSocketWrapper(new WebSocket(...) );
// Now use the WebSocketWrapper API... `socket.emit` for example
// See examples below...
```

Server-side

Use [ws-server-wrapper](https://github.com/bminer/ws-server-wrapper) to wrap
the WebSocketServer.  Or, you can wrap the WebSocket once a new WebSocket
connects like this:

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
var sockets = new Set();
wss.on("connection", (socket) => {
	var socket = new WebSocketWrapper(socket);
	sockets.add(socket);
	socket.on("msg", function(from, msg) {
		// `this` refers to the WebSocketWrapper instance
		console.log(`Received message from ${from}: ${msg}`);
		// Relay message to all clients
		sockets.forEach((socket) => {
			socket.emit("msg", from, msg);
		});
	});
	socket.on("disconnect", () => {
		sockets.delete(socket);
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
var sockets = new Set();
wss.on("connection", (socket) => {
	socket = new WebSocketWrapper(socket);
	sockets.add(socket);
	socket.on("userCount", () => {
		// Return value is sent back to the client
		return sockets.size;
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
		sockets.delete(socket);
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

`socket = new WebSocketWrapper(webSocketInstance[, options]);`

Constructs a new WebSocketWrapper, and binds it to the native WebSocket
instance.

- `webSocketInstance` - the native WebSocket instance
- `options`
	- `debug` - set to `true` to print debugging messages to `console.log`
	- `errorToJSON` - function to serialize Errors over the WebSocket.  In
		Node.js, the default is to send only the `message` property of
		the Error (for security reasons).  Errors that occur on the
		browser include all properties.
	- `requestTimeout` - maximum delay in ms. that the WebSocketWrapper
		will wait until rejecting the Promise of a pending request.
		Defaults to `null`, which means that there will be no timeout.
		This option is recommended for servers because clients who do
		not fulfill pending requests can cause memory leaks.

Events

- Event: "open"
	- `event` - The (worthless) event from the native WebSocket instance
- Event: "error"
	- `event` - The Error event from the native WebSocket instance
- Event: "message"
	- `event` - The [Message event](https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent)
			from the native WebSocket instance
	- `data` - The message data (same as `event.data`)
- Event: "close" / "disconnect"
	- `event` - The [Close event](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent)
			from the native WebSocket instance
	- `wasOpen` - `true` if the "open" event was fired on the native WebSocket
		instance before the "close" event was fired.

The EventEmitter-like API looks like this:

- `socket.on(eventName, listener)`
	Adds the `listener` function to the end of the listeners array for the
	event named `eventName`.  When an event or request matching the
	`eventName` is received by the WebSocket, the `listener` is called.

	Values returned by the `listener` callback are used to respond to
	requests (see `socket.request`).  If the return value of the `listener`
	is a `Promise`, the response to the request will be sent once the Promise
	is resolved or rejected; otherwise, the return value of the `listener` is
	sent back to the remote end immediately.

	If the inbound message is a simple event (see `socket.emit`), the return
	value of the `listener` is ignored.  It is also "safe" for the `listener`
	to return a `Promise` even if the inbound message is a "simple" event. If
	the returned `Promise` is rejected, an unhandled rejection will not occur;
	rather, the result of the Promise is just ignored.

	If the `listener` throws an Error, this Error will propagate up the stack
	as expected, and if the inbound message was a request, the Error is sent
	back to the remote end as a response rejection.
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
- `socket.timeout(tempTimeoutInMs)`
	Temporarily sets the `requestTimeout` to `tempTimeoutInMs` for the next request
	only.  This returns `socket` to allow chaining.  Typical usage:
	```javascript
	// The next request will be rejected if there is no response for 5 secs.
	let promise = socket.timeout(5 * 1000).request("readFile", "/etc/issue");
	```

The above EventEmitter functions like `on` and `once` are chainable (as
appropriate).

Channel API:
- `socket.of(channelName)`
 	Returns the channel with the specified `channelName`.  Every channel has the
 	same EventEmitter-like API as described above for sending and handling
 	channel-specific events and requests.

Other methods and properties:

By default, the WebSocketWrapper provides a queue for data to be sent.  Once the
WebSocket is open, this queue is flushed until the connection is lost.  The
following methods allow one to re-bind a new WebSocket or clear the send queue.

- `socket.abort()`
	Clears the send queue for this WebSocketWrapper and rejects all Promises for
	pending requests.
- `socket.bind(nativeWebSocket)`
	Binds this WebSocketWrapper to a new WebSocket.  This can be useful when
	socket reconnection logic needs to be implemented.  Instead of creating a
	new WebSocketWrapper each time a WebSocket is disconnected, one can simply
	bind a new WebSocket to the WebSocketWrapper.  In this way, data queued to
	be sent while the connection was dead will be sent over the new WebSocket
	passed to the `bind` function.
- `socket.isConnecting` - checks the native WebSocket `readyState` and is `true`
	if and only if the state is CONNECTING.
- `socket.isConnected` - checks the native WebSocket `readyState` is `true`
	if and only if the state is CONNECTED.
- `socket.send(data)`
	If connected, calls the native WebSocket's `send` method; otherwise, the
	data is added to the WebSocketWrapper's send queue.
- `socket.disconnect()`
	Closes the native WebSocket
- `socket.set(key, value)`
	Saves user data specific to this WebSocketWrapper
- `socket.get(key)`
	Retrieves user data.  See `socket.set(key, value)` above.

`WebSocketWrapper.MAX_SEND_QUEUE_SIZE`
	The maximum number of items allowed in the send queue.  If a user tries to
	send more messages than this number while a WebSocket is not connected,
	errors will be thrown.  Defaults to 10; changes affect all WebSocketWrapper
	instances.

## Protocol

All data passed over the native WebSocket should be valid JSON.
[ws-wrapper](https://github.com/bminer/ws-wrapper/) will parse the JSON string and determine
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
	where `i` is the request identifier and `e` is the error Object to be used
	when rejecting the response Promise.  If `_` is set, the `e` Object is
	converted into an Error instance upon receipt.

	```javascript
	{
		"i": 123,
		"e": {"message": "error message"},
		"_": 1
	}
	```

If the message received by the WebSocket is not valid JSON or if the parsed
Object does not match one of the above message types, then the message is
simply ignored by ws-wrapper.  Also if the JSON message contains a `ws-wrapper`
property with the value `false`, the message will be ignored.  This allows
other libraries to use the same WebSocket and send messages that will not be
processed by ws-wrapper.
