# ws-wrapper

A lightweight, isomorphic library that brings named events, Promise-based
requests, channels, and more to native
[WebSockets](https://en.wikipedia.org/wiki/WebSocket) — with first-class support
for **web browsers**, **Node.js**, and **Go**.

## What?

Raw WebSockets give you one primitive: `send()`. ws-wrapper builds a practical
communication layer on top of that, so instead of parsing and routing raw
messages yourself, you get:

- **Named events** – emit an event on one end, handle it on the other (similar
  to [Socket.IO](https://socket.io/docs/))
- **Request / response** – send a request and get back a Promise that resolves
  (or rejects) with the remote handler's return value
- **Channels** – logically namespace events over a single WebSocket connection
- **Streaming** – anonymous (request-scoped) channels permit streaming /
  iterator patterns
- **Cancellation** – cancel in-flight requests using the standard `AbortSignal`
  API, with cooperative cancellation support on the remote end
- **Bi-directionality** – clients can request data from the server, and the
  server can also request data from clients

By default, the wire protocol is a thin JSON layer over the native WebSocket,
keeping everything interoperable across JavaScript (browser or Node.js) and Go.
If needed, you can plug in custom `messageEncode` / `messageDecode` functions to
handle protocol frames (for example, to send binary frames).

## Why?

[Socket.IO](https://socket.io/docs/) is great, but it lacks a few features and
ships with the heavier [engine.io](https://github.com/socketio/engine.io)
transport stack. If you're already using a plain WebSocket, ws-wrapper gives you
the event handling and request/response patterns you actually want – without the
overhead. The entire library and its dependencies weigh **under 12 KB minified**
(**under 4 KB** minified and gzipped).

## Install

**Node.js / Browser**

```
npm install ws-wrapper
```

or for Node.js servers, use the recommended
[ws-server-wrapper](https://github.com/bminer/ws-server-wrapper) library:

```
npm install ws-server-wrapper
```

**Go server** (use with
[ws-server-wrapper-go](https://github.com/bminer/ws-server-wrapper-go))

```
go get github.com/bminer/ws-server-wrapper-go
```

## Usage

ws-wrapper is an isomorphic ES module, so it works in Node.js and in the browser
(with or without a bundler like Webpack or Parcel.js).

Check out the
[example-app](https://github.com/bminer/ws-wrapper/tree/master/example-app) for
a sample chat application (recommended).

#### Client-side

```javascript
// Use a bundler to make the next line of code "work" on the browser
import WebSocketWrapper from "ws-wrapper"
// Create a new socket
const socket = new WebSocketWrapper(new WebSocket("ws://" + location.hostname))
// Now use the WebSocketWrapper API... `socket.emit` for example
socket.emit("msg", "my_name", "This is a test message")
// See additional examples below...
```

Note: This library is designed to work with all modern browsers, but if you need
support for older browsers, try using a code transpiler like
[Babel](https://babeljs.io/).

#### Server-side (Node.js)

We recommend using
[ws-server-wrapper](https://github.com/bminer/ws-server-wrapper) to wrap the
WebSocketServer. See the
[ws-server-wrapper README](https://github.com/bminer/ws-server-wrapper/blob/master/README.md)
for more details.

If you don't want to use ws-server-wrapper, you can wrap the WebSocket yourself
once a new WebSocket connects like this:

```javascript
import { WebSocketServer } from "ws"
import WebSocketWrapper from "ws-wrapper"
var wss = new WebSocketServer({ port: 3000 })
wss.on("connection", (socket) => {
	socket = new WebSocketWrapper(socket)
	// ...
})
```

#### Server-side (Go)

Use [ws-server-wrapper-go](https://github.com/bminer/ws-server-wrapper-go) to
wrap your favorite WebSocket library. The example below uses the
[coder/websocket](https://github.com/coder/websocket) adapter:

```go
import (
    "log"
    "net/http"

    wrapper "github.com/bminer/ws-server-wrapper-go"
    "github.com/bminer/ws-server-wrapper-go/adapters/coder"
    "github.com/coder/websocket"
)

func main() {
    wsServer := wrapper.NewServer()
    // Register an event handler; return values are sent back as a response
    wsServer.On("echo", func(s string) (string, error) {
        return s, nil
    })
    // Create HTTP server that accepts WebSocket connections on /
    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        conn, err := websocket.Accept(w, r, nil)
        if err != nil {
            return
        }
        wsServer.Accept(coder.Wrap(conn))
    })
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

See the [ws-server-wrapper-go](https://github.com/bminer/ws-server-wrapper-go)
repository for a complete example and other adapter options.

#### Other servers

Please implement ws-wrapper in your favorite language, and let me know about it!
I'll give you beer!

## Event Handling

It's what you'd expect of an event handler API.

Call `on` or `once` to bind an event handler to the `wrapper` or to a channel.
Call `emit` to send an event.

Server-side Example (_without using ws-server-wrapper_):

```javascript
import { WebSocketServer } from "ws"
import WebSocketWrapper from "ws-wrapper"
var wss = new WebSocketServer({ port: 3000 })
var sockets = new Set()
wss.on("connection", (socket) => {
	var socket = new WebSocketWrapper(socket)
	sockets.add(socket)
	socket.on("msg", function (from, msg) {
		// `this` refers to the WebSocketWrapper instance
		console.log(`Received message from ${from}: ${msg}`)
		// Relay message to all clients
		sockets.forEach((socket) => {
			socket.emit("msg", from, msg)
		})
	})
	socket.on("disconnect", () => {
		sockets.delete(socket)
	})
})
```

Client-side Example:

```javascript
// Use a bundler to make the next line of code "work" on the browser
import WebSocketWrapper from "ws-wrapper"
// Establish connection
var socket = new WebSocketWrapper(new WebSocket("ws://" + location.host))
// Add "msg" event handler
socket.on("msg", function (from, msg) {
	console.log(`Received message from ${from}: ${msg}`)
})
// Emit "msg" event
socket.emit("msg", "my_name", "This is a test message")
```

Note: By default, this module uses `JSON.stringify` / `JSON.parse` to encode
protocol data over the raw WebSocket connection. This means that encoding
circular references is not supported out of the box. You can override this with
the `messageEncode` / `messageDecode` constructor options.

## Channels

Just like in socket.io, you can "namespace" your events using channels. When
sending messages to multiple channels, the same WebSocket connection is reused,
but the events are logically separated into their appropriate channels.

By default, calling `emit` directly on a WebSocketWrapper instance will send the
message over the "default" channel. To send a message over a channel named
"foo", just call `socket.of("foo").emit("eventName", "yourData")`.

## Request / Response

Event handlers can return values or
[Promises](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
to respond to requests. The response is sent back to the remote end.

The example below shows the client requesting data from the server, but
ws-wrapper also allows servers to request data from the client.

Server-side Example (_without using ws-server-wrapper_):

```javascript
import fs from "node:fs"
import { WebSocketServer } from "ws"
import WebSocketWrapper from "ws-wrapper"
const wss = new WebSocketServer({ port: 3000 })
const sockets = new Set()
wss.on("connection", (socket) => {
	socket = new WebSocketWrapper(socket)
	sockets.add(socket)
	socket.on("userCount", () => {
		// Return value is sent back to the client
		return sockets.size
	})
	socket.on("readFile", (path) => {
		// We can return a Promise that eventually resolves
		return new Promise((resolve, reject) => {
			// TODO: `path` should be sanitized for security reasons
			fs.readFile(path, (err, data) => {
				// `err` or `data` are now sent back to the client
				if (err) reject(err)
				else resolve(data.toString("utf8"))
			})
		})
	})
	socket.on("disconnect", () => {
		sockets.delete(socket)
	})
})
```

Client-side Example:

```javascript
// Assuming WebSocketWrapper is somehow available to this scope...
const socket = new WebSocketWrapper(new WebSocket("ws://" + location.host))
var p = socket.request("userCount")
// `p` is a Promise that will resolve when the server responds...
p.then((count) => {
	console.log("User count: " + count)
}).catch((err) => {
	console.error("An error occurred while getting the user count:", err)
})
socket
	.request("readFile", "/etc/issue")
	.then((data) => {
		console.log("File contents:", data)
	})
	.catch((err) => {
		console.error("Error reading file:", err)
	})
```

### Request Timeout

Call `.timeout(ms)` directly before `.request(...)` like this:

```js
const promise = socket.timeout(5 * 1000).request("readFile", "/etc/issue")
```

The `timeout` function affects the next call of `request`.

### Request Cancellation

Starting in version 4, ws-wrapper supports request cancellation using the Web
standard `AbortSignal` API. This allows you to cancel in-flight requests from
either the client or server side.

```javascript
// Send a request that can be cancelled
const controller = new AbortController()
const promise = socket.signal(controller.signal).request("longOperation", data)
// Cancel the request at any time
controller.abort()
// The promise will be rejected with "Request aborted"
promise.catch((err) => {
	if (err instanceof RequestAbortedError) {
		console.log("Request was cancelled by user")
	}
})
// The remote end will also be notified of the cancellation
```

Event handlers can access the `AbortSignal` via `this.signal` to implement
cooperative cancellation:

```javascript
socket.on("longOperation", async function (data) {
	// Do long running work, checking signal periodically
	for (let i = 0; i < 10; i++) {
		if (this.signal?.aborted) {
			throw new Error("Operation was cancelled")
		}
		await doSomeWork()
	}
	return "Operation completed"
})
```

### Combining with Timeout

You can use both timeout and cancellation together:

```javascript
import WebSocketWrapper, {
	RequestTimeoutError,
	RequestAbortedError,
} from "ws-wrapper"

const controller = new AbortController()
const promise = socket
	.timeout(30000) // 30 second timeout
	.signal(controller.signal) // User cancellation
	.request("heavyComputation", data)

// Handle different error types
promise.catch((err) => {
	if (err instanceof RequestTimeoutError) {
		console.log("Request timed out after 30 seconds")
	} else if (err instanceof RequestAbortedError) {
		console.log("Request was cancelled by user")
	} else {
		console.log("Request failed with other error:", err)
	}
})
```

## Anonymous Channels

**Anonymous channels** are request-scoped channels. A request handler can call
`this.channel()` to create a channel and return it, and the requestor's
`request()` Promise resolves to a full `WebSocketChannel` instead of a plain
value. This provides a scoped, two-way communication primitive for streaming,
pagination, and other multi-message patterns — all over a single WebSocket
connection.

Anonymous channels should be explicitly closed when done. Use `chan.close()` to
clean up locally; use `chan.abort()` to also notify the remote end (which closes
its anonymous channel). Calling `emit` or `request` on a closed channel throws
an error. If the remote end sends a cancellation for the channel, the local
channel is automatically closed and `closeSignal.reason` is set to the
reconstructed cancellation reason.

### One-way streaming (server pushes values to client)

Server-side example:

```javascript
socket.on("watchTemperature", function () {
	// Create an anonymous channel
	const chan = this.channel()
	// Register whatever listeners the client will emit on the channel
	chan.on("stop", () => chan.close())
	chan.on("start", () => {
		// Start pushing temperature readings once the client is ready
		const timer = setInterval(() => {
			try {
				// emit() / request() will throw if chan closes
				chan.emit("temp", getSensorReading())
			} catch (err) {
				clearInterval(timer)
			}
		}, 1000)
		// Clean up when the channel is closed
		chan.closeSignal?.addEventListener("abort", () => clearInterval(timer))
	})
	// Note: calling `chan.emit()` or `chan.request()` is not allowed here...
	// You have to return the channel first!
	return chan // returning a channel sends it to the requestor
})
```

Client-side example:

```javascript
// request() resolves to the anonymous channel
const chan = await socket.request("watchTemperature")
chan.on("temp", (val) => console.log("Temperature:", val))
chan.emit("start") // start emitting after "temp" event handler is registered

// Stop the stream after 10 seconds
setTimeout(() => {
	chan.emit("stop")
	chan.close()
}, 10000)
```

### Two-way communication (sub-requests on the channel)

Server-side example:

```javascript
socket.on("openCalculator", function () {
	const chan = this.channel()
	chan.on("add", function (a, b) {
		return a + b // return value is sent back as a response
	})
	chan.on("multiply", function (a, b) {
		return a * b
	})
	chan.on("done", () => chan.close())
	return chan
})
```

Client-side example:

```javascript
const calc = await socket.request("openCalculator")
const sum = await calc.request("add", 3, 4) // 7
const product = await calc.request("multiply", 6, 7) // 42
calc.emit("done") // closes remote side
calc.close() // closes my side *OR* calc.abort() closes both sides
```

### Async iterator

Anonymous channels have a built-in `[Symbol.asyncIterator]` implementation,
enabling one-way streaming using `for await...of`. The handler drives the stream
by emitting `"next"` events with `{ value, done }` payloads; the iterator emits
`"start"` on the first call to `next()` to signal readiness.

Server-side example:

```javascript
socket.on("generateNumbers", function () {
	const chan = this.channel()
	return chan.on("start", () => {
		for (let i = 1; i <= 100; i++) {
			chan.emit("next", { value: i, done: false })
		}
		chan.emit("next", { value: undefined, done: true })
		chan.close() // clean up server-side channel
	})
})
```

Client-side example:

```javascript
const chan = await socket.request("generateNumbers")
for await (const value of chan) {
	console.log(value) // 1, 2, ..., 100
}
// Iterator completed; channel is still open, so we close it
chan.close()
```

### `iterableHandler` — generators as stream handlers

`iterableHandler` lets you write a streaming handler as a plain JS generator
(sync or async) instead of wiring `"start"` / `"next"` events by hand. Return
any sync or async iterable and ws-wrapper handles the rest.

```javascript
import WebSocketWrapper, { iterableHandler } from "ws-wrapper"

// Sync generator — yields items one by one
socket.on(
	"generateNumbers",
	iterableHandler(function* () {
		for (let i = 1; i <= 100; i++) yield i
	})
)

// Async generator — works with async data sources
socket.on(
	"streamRows",
	iterableHandler(async function* (query) {
		for await (const row of db.query(query)) {
			yield row
		}
	})
)

// Any iterable works — arrays, Sets, Maps, generators, ...
socket.on(
	"listUsers",
	iterableHandler(() => activeUsers)
)
```

The client side is unchanged — `request()` resolves to the anonymous channel and
`for await...of` consumes it:

```javascript
const chan = await socket.request("generateNumbers")
for await (const value of chan) {
	console.log(value) // 1, 2, ..., 100
}
chan.close()
```

If the requestor aborts the anonymous channel mid-stream, the generator stops on
the next iteration. `yield` always evaluates to `undefined` since the stream is
one-way.

### Signal inheritance

When a requestor uses `signal()` with a `request()` that resolves to an
anonymous channel, the AbortSignal is inherited by the anonymous channel. If the
signal aborts after the channel is created, `chan.abort()` is called
automatically, sending a cancellation to the remote end and closing the channel
locally.

```javascript
const controller = new AbortController()
const chan = await socket.signal(controller.signal).request("startStream")
// The channel inherits the signal; aborting it aborts the channel.
controller.abort()
```

> [!NOTE]
>
> `timeout()` is **not** inherited by the anonymous channel. To impose a time
> limit on both the request and anonymous channel, pass an
> `AbortSignal.timeout()` as the signal:
>
> ```javascript
> const chan = await socket
> 	.signal(AbortSignal.timeout(30_000))
> 	.request("startStream")
> ```

## API

See [API.md](API.md) for the full API reference, including:

- `WebSocketWrapper` constructor and options
- Channels (`socket.of()`)
- EventEmitter-like API (`on`, `once`, `emit`, etc.)
- Request / Response (`request`, `timeout`, `signal`)
- Async Iterator (one-way streaming) and `iterableHandler`
- Middleware
- Other methods, properties, and error classes

## Protocol

See [PROTOCOL.md](PROTOCOL.md) for the full wire protocol specification,
including all message types (Event Dispatch, Request, Response, Request
Cancellation, Anonymous Channel messages, and more).

## Auto-Reconnect

ws-wrapper does not implement auto-reconnect functionality out of the box. For
those who want it (_almost_ everyone), I have written some sample code to show
how easy it is to add.

[How to implement auto-reconnect for ws-wrapper](https://github.com/bminer/ws-wrapper/wiki/Client-side-Auto-Reconnect)

If someone wants to make an npm package for the auto-reconnect feature, I'd be
happy to list it here, but it will probably never be a core ws-wrapper feature.
