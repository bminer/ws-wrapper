# ws-wrapper API Reference

## WebSocketWrapper

A WebSocketWrapper simply wraps around a WebSocket to give you well-deserved
functionality. :smile:

`socket = new WebSocketWrapper(webSocketInstance[, options]);`

Constructs a new WebSocketWrapper and binds it to the native WebSocket instance.

- `webSocketInstance` - the
  [WebSocket instance](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- `options`
  - `debug` - set to `true` to print debugging messages to `console.log`; set to
    a function to call the custom function.
  - `errorToJSON` - function to encode Errors over the WebSocket. By default,
    only the `message` property is sent (for security reasons). When running in
    a browser environment (detected via `typeof document !== "undefined"`), all
    own properties of the Error are sent so that custom error fields are
    preserved on the receiving end.
  - `requestTimeout` - default request timeout in milliseconds for outbound
    requests. Defaults to `null`, which means that there will be no timeout.
    This option is recommended for servers because clients who do not fulfill
    pending requests can cause memory leaks. As of version 4, we send
    cancellation messages to the remote end for requests that time out.
  - `messageEncode` - optional function to encode ws-wrapper protocol Objects
    before `WebSocket.send()`. Defaults to `JSON.stringify`.
  - `messageDecode` - optional function to decode inbound `event.data` before
    ws-wrapper routing. Defaults to `JSON.parse`.

Events

- Event: "open" / "connect"
  - `event` - The (worthless) event from the native WebSocket instance
- Event: "error"
  - `event` - The Error event from the native WebSocket instance
- Event: "message"
  - `event` - The
    [Message event](https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent)
    from the native WebSocket instance
  - `data` - The message data (same as `event.data`)
- Event: "close" / "disconnect"
  - `event` - The
    [Close event](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent)
    from the native WebSocket instance
  - `wasOpen` - `true` if the "open" event was fired on the native WebSocket
    instance before the "close" event was fired.

_Note: The "special" events listed above are not sent over the WebSocket._

Every WebSocketWrapper (i.e. `socket`) is also a WebSocketChannel, which has an
EventEmitter-like API, request / response API, and more. Multiple channels can
be created to namespace events, despite using a single WebSocket connection.

## Channels

`const channel = socket.of(channelName)`

Returns the channel with the specified `channelName`, creating it if needed.
Throws a `TypeError` if `channelName` is an empty string. Every channel has the
same EventEmitter-like API described below for sending and handling
channel-specific events and requests.

- `channel.name` Read-only `name` property matching the `channelName`. If the
  channel does not already exist, it is created.
- `channel.isAnonymous` Read-only boolean; `true` for anonymous channels created
  via `this.channel()` in a request handler **or** received as the resolved
  value of `socket.request()` on the requestor side. `false` for named channels
  and the root wrapper.
- `channel.closeSignal` Read-only `AbortSignal` (or `null` if the runtime does
  not support `AbortController`) that is aborted when the channel is closed via
  `close()` or `abort()`. Use this to register cleanup handlers that run when
  the channel is torn down. The signal's `reason` property reflects the value
  passed to `close(reason)` or `abort(err)`, including reasons reconstructed
  from inbound anonymous-channel cancellation messages:

  ```javascript
  chan.closeSignal?.addEventListener("abort", () => {
  	console.log("channel closed:", chan.closeSignal.reason)
  	clearInterval(timer)
  })
  ```

- `channel.close([reason])` Removes the channel from the wrapper and cleans up
  all registered event listeners and middleware. After calling `close()`, the
  channel should no longer be used. For anonymous channels, any registered abort
  signal listeners are also removed. The optional `reason` value is forwarded to
  the internal `AbortController`, so `closeSignal.reason` will reflect the value
  passed here. This is also how the reason from an inbound anonymous-channel
  cancellation message is surfaced to `closeSignal.reason`.

## EventEmitter-like API

Both the WebSocketWrapper and WebSocketChannel implement the following methods:

- `channel.on(eventName, listener)` Adds the `listener` function to the end of
  the listeners array for the event named `eventName`. When an event or request
  matching the `eventName` is received by the WebSocket, the `listener` is
  called.

  Values returned by the `listener` callback are used to respond to requests
  (see `socket.request`). If the return value of the `listener` is a `Promise`,
  the response to the request will be sent once the Promise is resolved or
  rejected; otherwise, the return value of the `listener` is sent back to the
  remote end immediately. If the return value of the `listener` is a
  `WebSocketChannel` created via `this.channel()`, the requestor's `request()`
  Promise resolves to the anonymous channel (see Anonymous Channels above).

  If the inbound message is a simple event (see `socket.emit`), the return value
  of the `listener` is ignored. It is also "safe" for the `listener` to return a
  `Promise` even if the inbound message is a "simple" event. If the returned
  `Promise` is rejected, an unhandled rejection will not occur; rather, the
  result of the Promise is just ignored.

  If the `listener` throws an Error and the inbound message was a request, the
  Error is sent back to the remote end as a response rejection. For simple
  events, the Error is silently dropped. This is intentional: event handlers
  often don't distinguish between the two cases, so propagating the error
  further would cause surprising crashes.

  Event listeners also have access to `this`, which points to the event
  listener's socket / channel. In addition to the channel's API, the following
  are also available:
  - `this.signal` The AbortSignal for the current request if the requestor used
    `request(...)`; if the requestor used `emit(...)` to emit the event or if
    AbortController is not available to the runtime, this is `undefined`. The
    event handler can check this to see if the request has been cancelled and
    abort early.
  - `const anonChan = this.channel()` Creates and returns an anonymous channel
    scoped to this request. Returns the same channel instance if called more
    than once for the same request. Calling `emit()` or `request()` on the
    channel before returning it from the handler throws an error; once the
    channel is delivered to the requestor, all methods are available.

- `channel.once(eventName, listener)` Adds a one time `listener` function for
  the event named `eventName`; otherwise, this behaves exactly like `on` above.
- `channel.removeListener(eventName, listener)` Removes the specified `listener`
  from the listener array for the event named `eventName`.
- `channel.removeAllListeners([eventName])` Removes all listeners, or those of
  the specified `eventName`.
- `channel.eventNames()` Returns an array listing the events for which the
  emitter has registered listeners.
- `channel.listeners(eventName)` Returns a copy of the array of listeners for
  the event named `eventName`.
- `channel.emit(eventName[, ...args])` Sends an event down the WebSocket with
  the specified `eventName` calling all listeners for `eventName` on the remote
  end, in the order they were registered, passing the supplied arguments to
  each. Calling `emit` on a closed channel will throw.

The above EventEmitter functions like `on` and `once` are chainable (as
appropriate).

## Request / Response

- `channel.request(eventName[, ...args])` Sends a request down the WebSocket
  with the specified `eventName` and returns a
  [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)
  that will resolve once the remote event listener responds. If the remote
  handler returns an anonymous channel (via `this.channel()`), the Promise
  resolves to a `WebSocketChannel` instance instead of a plain value; see the
  [Anonymous Channels](README.md#anonymous-channels) section in the README.

  **Note**: While it is common design for only one event listener to exist on
  the remote end, all listeners for `eventName` on the remote end are called, in
  the order they were registered, passing the supplied arguments to each. Since
  Promises can only be resolved or rejected once, only the data from the first
  event listener is used to generate the response for this request.

  **Note**: If a request is sent, but there is no remote event listener to
  respond to the request, a response rejection is immediately sent back by the
  remote end.

- `channel.timeout(ms)` Temporarily set the timeout for the next request only.
  This returns `channel` to allow chaining. Applies to both named and anonymous
  channels. Typical usage:

  ```js
  // The next request will be rejected if there is no response for 5 secs.
  let promise = socket.timeout(5 * 1000).request("readFile", "/etc/issue")
  ```

- `channel.signal(abortSignal)` Temporarily set the `AbortSignal` for the next
  request only. This allows cancellation of in-flight requests. This returns
  `channel` to allow chaining. Can be combined with `timeout()`. Typical usage:

  ```js
  const controller = new AbortController()
  // The next request can be cancelled using the AbortController
  let promise = socket
  	.of("compute")
  	.signal(controller.signal)
  	.request("longOperation", data)
  // Later, we can cancel the request. In this case, our Promise will be
  // immediately rejected with RequestAbortedError, and the remote end will
  // receive a cancellation message.
  controller.abort()
  ```

## Async Iterator (One-way Streaming)

An anonymous channel implements the
[async iterator protocol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#the_async_iterator_and_async_iterable_protocols),
enabling one-way streaming from the handler side to the requestor side using
`for await...of`:

```js
// --- Requestor side ---
const chan = await socket.request("open-stream")
for await (const value of chan) {
	console.log(value)
}
// Channel is still open after the loop; close or abort when done.
chan.close()

// --- Handler side (drives the stream) ---
socket.on("open-stream", function () {
	const chan = this.channel()
	// Return the channel first; the requestor then emits "start" when ready.
	chan.on("start", async () => {
		for (const item of items) {
			chan.emit("next", { value: item, done: false })
			await delay(100)
		}
		chan.emit("next", { value: undefined, done: true })
		chan.close() // clean up server-side channel
	})
	return chan
})
```

The remote handler drives the stream by emitting `"next"` events on the
anonymous channel with `{ value, done }` payloads. When `done` is `true`, the
iterator completes; the channel itself remains open.

### `iterableHandler(fn)` helper

`iterableHandler` is a convenience wrapper that lets you write a stream handler
as a plain generator (sync or async) instead of manually wiring up `"start"` and
`"next"` events. If `fn` returns a sync or async iterable Object, ws-wrapper
handles the channel setup automatically. If it returns anything else, the
requestor's `request()` Promise is rejected with a `TypeError`.

```js
import WebSocketWrapper, { iterableHandler } from "ws-wrapper"

// Sync generator
socket.on(
	"data-stream",
	iterableHandler(function* (filter) {
		for (const item of allItems.filter(filter)) {
			yield item
		}
	})
)

// Async generator
socket.on(
	"data-stream",
	iterableHandler(async function* (filter) {
		for await (const item of dbCursor(filter)) {
			yield item
		}
	})
)

// Any iterable works — arrays, Sets, Maps, etc.
socket.on(
	"list-users",
	iterableHandler(function () {
		return userSet // a Set is iterable
	})
)
```

Since the stream is one-way (handler → requestor), `yield` expressions always
evaluate to `undefined`; the requestor cannot send values back through the
channel.

**Cancellation**: if the requestor closes or aborts the anonymous channel while
the generator is running, iteration stops gracefully on the next `yield`.

**Handshake**: on the first call to `iterator.next()` (including the first
iteration of `for await...of`), the iterator emits a `"start"` event on the
channel so the handler knows the consumer is ready. The handler should listen
for `"start"` before emitting any `"next"` events. `iterableHandler` does this
automatically.

**Buffering**: the iterator buffers at most **one** unconsumed item. The
consumer must call `next()` (or advance the `for await...of` loop) before the
next item arrives. If two items arrive before the consumer reads the first, the
iterator errors with a buffer-overflow but the channel remains open.

**Early exit**: breaking out of a `for await...of` loop (or calling
`iterator.return()`) stops iteration but does **not** close the channel. Call
`chan.close()` or `chan.abort()` afterward if the channel is no longer needed.

**Throwing**: calling `iterator.throw(err)` sends a cancellation message to the
remote end (anonymous channels only), closes the channel, and rejects with
`err`.

**External close**: if the channel is closed by a signal abort or explicit
`chan.close()` / `chan.abort()` while the consumer is waiting, the pending
`next()` Promise is rejected with an error.

## Middleware

`socket.use(function fn(eventName, args, next) {...})`

Adds a middleware function `fn` to receive all messages for the channel. The
`eventName` indicates the name of the event or request, and the `args` are the
arguments to be passed to the respective event handler. `next([err])` should be
called to continue processing to the next middleware function. Once all
middleware have processed the event and called `next`, the event is then
processed by the event handler(s) for the `eventName`. If `next(err)` is called
with an Error, the event will not be handled by subsequent middleware or
registered event handlers, and if it's a request, a response rejection is sent
back to the remote end.

## Other methods and properties

By default, the WebSocketWrapper provides a queue for data to be sent. Once the
WebSocket is open, this queue is flushed until the connection is lost. The
following methods allow one to re-bind a new WebSocket or clear the send queue.
This is useful for reconnecting or connecting to a different server.

- `socket.abort(err)` Clears the send queue for this WebSocketWrapper and
  rejects all Promises for pending requests with `err`. If `err` is not provided
  or is not an `Error` instance, a `RequestAbortedError` is used.
- `socket.bind(nativeWebSocket)` Binds this WebSocketWrapper to a new WebSocket.
  This can be useful when socket reconnection logic needs to be implemented.
  Instead of creating a new WebSocketWrapper each time a WebSocket is
  disconnected, one can simply bind a new WebSocket to the WebSocketWrapper. In
  this way, data queued to be sent while the connection was dead will be sent
  over the new WebSocket passed to the `bind` function.
- `socket.isConnecting` - checks the native WebSocket `readyState` and is `true`
  if and only if the state is CONNECTING.
- `socket.isConnected` - checks the native WebSocket `readyState` is `true` if
  and only if the state is OPEN.
- `socket.send(data)` If connected, calls the native WebSocket's `send` method;
  otherwise, the data string is added to the WebSocketWrapper's send queue.
- `socket.disconnect()` Closes the native WebSocket
- `socket.set(key, value)` Saves user data specific to this WebSocketWrapper
- `socket.get(key)` Retrieves user data. See `socket.set(key, value)` above.

`WebSocketWrapper.MAX_SEND_QUEUE_SIZE` The maximum number of items allowed in
the send queue. If a user tries to send more messages than this number while a
WebSocket is not connected, errors will be thrown. Defaults to 10; changes
affect all WebSocketWrapper instances.

## Error Classes

ws-wrapper exports custom error classes that extend the standard `Error` class
to provide more specific error handling for different failure scenarios.

### RequestTimeoutError

This error is thrown when a request exceeds the configured timeout period. The
timeout can be set globally via the `requestTimeout` constructor option or
per-request using the `.timeout()` method.

- `name` "RequestTimeoutError"
- `message` "Request timed out"

```javascript
import WebSocketWrapper, { RequestTimeoutError } from "ws-wrapper"

socket
	.timeout(5000)
	.request("slowOperation")
	.catch((err) => {
		if (err instanceof RequestTimeoutError) {
			console.log("Request timed out after 5 seconds")
		}
	})
```

### RequestAbortedError

This error is thrown when a request is cancelled via an `AbortSignal`. The
optional `reason` property contains any cancellation reason that was provided
when calling `abort()`.

- `name` "RequestAbortedError"
- `message` "Request aborted"
- `reason` The reason passed to `AbortController.abort()` (if any)

```javascript
import WebSocketWrapper, { RequestAbortedError } from "ws-wrapper"

const controller = new AbortController()
socket
	.signal(controller.signal)
	.request("longOperation")
	.catch((err) => {
		if (err instanceof RequestAbortedError) {
			console.log("Request was cancelled:", err.reason)
		}
	})

// Cancel the request
controller.abort("User cancelled")
```

### Accessing Error Classes

Error classes are available in multiple ways:

```javascript
// Named imports
import { RequestTimeoutError, RequestAbortedError } from "ws-wrapper"
// Via the main class
import WebSocketWrapper from "ws-wrapper"
const TimeoutError = WebSocketWrapper.RequestTimeoutError
const AbortedError = WebSocketWrapper.RequestAbortedError
```
