/**
 * A minimal WebSocket-like interface accepted by WebSocketWrapper.
 * Compatible with the browser's native WebSocket and the `ws` npm package.
 */
export interface WebSocketLike {
	readonly readyState: number
	send(data: unknown): void
	close(code?: number, reason?: string): void
	onopen: ((event: unknown) => void) | null
	onmessage: ((event: { data: unknown }) => void) | null
	onerror: ((event: unknown) => void) | null
	onclose: ((event: unknown) => void) | null
}

/**
 * Middleware function signature for use with {@link WebSocketChannel.use}.
 * Call `next()` to pass the event through, or `next(err)` to drop it.
 */
export type MiddlewareFn = (
	eventName: string,
	args: unknown[],
	next: (err?: Error) => void
) => void

/**
 * A single event handler function. Using `any` for arguments allows concrete
 * typed handlers (e.g. `(x: string) => void`) to be assignable to this type
 * under TypeScript's function parameter variance rules.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EventFn = (...args: any[]) => unknown

/**
 * A map of event names to their handler function types. Pass this as a type
 * argument to {@link WebSocketChannel} or {@link WebSocketWrapper} to enable
 * typed `on()`, `emit()`, and `request()` calls.
 *
 * - **`TRemoteEvents`** (first argument) — describes events handled by the
 *   remote peer. Constrains `emit()` arguments and infers the return type of
 *   `request()`.
 * - **`TLocalEvents`** (second argument, optional) — describes events handled
 *   by this side. Constrains the listener types passed to `on()` and `once()`.
 *   Defaults to `TRemoteEvents`, which is correct for symmetric APIs where both
 *   sides handle the same events.
 *
 * **Symmetric API** (both sides handle the same events — most common):
 * ```ts
 * interface ChatEvents {
 *   msg: (from: string, text: string) => void
 * }
 * const socket = new WebSocketWrapper<ChatEvents>(rawSocket)
 * socket.on("msg", (from, text) => console.log(from, text)) // args are typed
 * socket.emit("msg", "alice", "hello")                      // args are typed
 * ```
 *
 * **Asymmetric API** (client calls server, server calls client differently):
 * ```ts
 * interface ServerAPI { add: (a: number, b: number) => number }
 * interface ClientAPI { notify: (msg: string) => void }
 *
 * // Client: remote=ServerAPI, local=ClientAPI
 * const client = new WebSocketWrapper<ServerAPI, ClientAPI>(rawSocket)
 * const sum = await client.request("add", 1, 2) // typed as number
 * client.on("notify", (msg) => alert(msg))       // msg is string
 *
 * // Server: remote=ClientAPI, local=ServerAPI
 * const server = new WebSocketWrapper<ClientAPI, ServerAPI>(rawSocket)
 * server.on("add", (a, b) => a + b)              // a, b are number
 * server.emit("notify", "hello")                 // arg is string
 * ```
 *
 * To express a handler that returns an anonymous channel (for streaming), use
 * `Promise<WebSocketChannel>` as the return type in the event map:
 * ```ts
 * interface ServerAPI {
 *   streamNumbers: () => Promise<WebSocketChannel>
 * }
 * const chan = await socket.request("streamNumbers") // typed as WebSocketChannel
 * for await (const n of chan) { ... }
 * ```
 *
 * Requires TypeScript 4.5 or later (uses the built-in `Awaited` utility type).
 */
export type EventMap = Record<string, EventFn>

/**
 * A namespaced channel backed by a {@link WebSocketWrapper}.
 * Exposes an EventEmitter-like API scoped to a channel name.
 *
 * @typeParam TRemoteEvents - Events handled by the remote peer (constrains
 *   `emit()` and `request()`). Defaults to the loose {@link EventMap} type,
 *   which allows any string key and degrades to untyped behaviour.
 * @typeParam TLocalEvents - Events handled by this side (constrains `on()`
 *   and `once()` listeners). Defaults to `TRemoteEvents`.
 */
export declare class WebSocketChannel<
	TRemoteEvents extends EventMap = EventMap,
	TLocalEvents extends EventMap = TRemoteEvents,
> {
	/** The channel namespace, or `null` for the root wrapper. */
	readonly name: string | null

	/**
	 * `true` for anonymous (request-scoped) channels: those created via
	 * `this.channel()` inside a request handler **and** those received as the
	 * resolved value of {@link request} on the requestor side.
	 * `false` for named channels and the root wrapper.
	 */
	readonly isAnonymous: boolean

	/**
	 * An `AbortSignal` that is aborted when this channel is closed (via
	 * {@link close} or {@link abort}). Useful for registering cleanup
	 * handlers that run when the channel is torn down. `null` if the runtime
	 * does not support `AbortController`.
	 *
	 * The signal's `reason` property reflects the value passed to
	 * `close(reason)` or `abort(err)`, including reasons reconstructed from
	 * inbound anonymous-channel cancellation messages.
	 */
	readonly closeSignal: AbortSignal | null

	/**
	 * Register a persistent event listener.
	 * For all ws-wrapper events, the listener is called with the deserialized
	 * arguments from the remote peer.
	 *
	 * Inside a **request** handler `this` is a per-request context object that
	 * inherits all channel methods and additionally exposes:
	 * - `this.signal` – the request's `AbortSignal` (if cancellation is supported)
	 * - `this.channel()` – creates and returns an anonymous (request-scoped)
	 *   {@link WebSocketChannel}. Returns the same instance if called more than
	 *   once per request. Returning the channel from the handler causes the
	 *   requestor's `request()` Promise to resolve to the channel instead of a
	 *   plain value.
	 */
	on<K extends keyof TLocalEvents & string>(
		eventName: K,
		listener: TLocalEvents[K]
	): this
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	on(eventName: string, listener: (...args: any[]) => any): this

	/** Alias for {@link on}. */
	addListener<K extends keyof TLocalEvents & string>(
		eventName: K,
		listener: TLocalEvents[K]
	): this
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	addListener(eventName: string, listener: (...args: any[]) => any): this

	/** Register a one-time event listener that is removed after it fires once. */
	once<K extends keyof TLocalEvents & string>(
		eventName: K,
		listener: TLocalEvents[K]
	): this
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	once(eventName: string, listener: (...args: any[]) => any): this

	/** Remove a previously registered listener. */
	removeListener<K extends keyof TLocalEvents & string>(
		eventName: K,
		listener: TLocalEvents[K]
	): this
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	removeListener(eventName: string, listener: (...args: any[]) => any): this

	/** Alias for {@link removeListener}. */
	off<K extends keyof TLocalEvents & string>(
		eventName: K,
		listener: TLocalEvents[K]
	): this
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	off(eventName: string, listener: (...args: any[]) => any): this

	/** Remove all listeners for `eventName`, or for all events if omitted. */
	removeAllListeners(eventName?: string): this

	/** Returns the names of all events that have registered listeners. */
	eventNames(): (keyof TLocalEvents & string)[]

	/** Returns the listeners registered for `eventName`. */
	listeners<K extends keyof TLocalEvents & string>(
		eventName: K
	): TLocalEvents[K][]
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	listeners(eventName: string): ((...args: any[]) => any)[]

	/**
	 * Emit an event to the remote peer over the WebSocket.
	 * For reserved events on the root wrapper, emits locally instead.
	 * Throws if the channel has been closed.
	 */
	emit<K extends keyof TRemoteEvents & string>(
		eventName: K,
		...args: Parameters<TRemoteEvents[K]>
	): void
	emit(eventName: string, ...args: unknown[]): void

	/**
	 * Set a one-shot timeout (ms) for the next {@link request} call only.
	 * Overrides the wrapper-level `requestTimeout` option for that request.
	 * Applies to both named and anonymous channels.
	 *
	 * @returns This channel for chaining.
	 */
	timeout(ms: number): this

	/**
	 * Set the AbortSignal for the next {@link request} call only. When the
	 * signal aborts, the request is cancelled and a cancellation message is
	 * sent to the remote end. Applies to both named and anonymous channels.
	 *
	 * @returns This channel for chaining.
	 */
	signal(abortSignal: AbortSignal): this

	/**
	 * Send a request to the remote peer and return a Promise that resolves
	 * with the response value. Rejects with {@link RequestTimeoutError} on
	 * timeout, or {@link RequestAbortedError} if cancelled.
	 * Throws if the channel has been closed.
	 *
	 * When the remote handler returns an anonymous channel (via
	 * `this.channel()`), declare its return type as `Promise<WebSocketChannel>`
	 * in your event map and the resolved type will be `WebSocketChannel`.
	 */
	request<K extends keyof TRemoteEvents & string>(
		eventName: K,
		...args: Parameters<TRemoteEvents[K]>
	): Promise<Awaited<ReturnType<TRemoteEvents[K]>>>
	request(
		eventName: string,
		...args: unknown[]
	): Promise<unknown | WebSocketChannel>

	/**
	 * Add a middleware function for this channel.  Middleware runs before event
	 * handlers and can inspect, modify, or block incoming events by calling
	 * `next(err)`.
	 * @returns This channel for chaining.
	 */
	use(fn: MiddlewareFn): this

	/**
	 * Remove this channel from the wrapper and clean up all listeners,
	 * middleware, and abort signal subscriptions. The optional `reason` is
	 * forwarded to the internal `AbortController` so that `closeSignal.reason`
	 * reflects why the channel was closed.
	 */
	close(reason?: unknown): void

	/**
	 * For anonymous channels only: send a cancellation message to the remote
	 * peer and close this channel. The optional `err` is serialized as the
	 * cancellation reason; if omitted a default {@link RequestAbortedError} is
	 * sent. A no-op if the channel is not anonymous or is already closed.
	 */
	abort(err?: Error): void

	/**
	 * Returns an async iterator that consumes a one-way stream driven by the
	 * remote peer. The remote emits `"next"` events on the channel with
	 * `{ value, done }` payloads. At most one item is buffered; if a second
	 * item arrives before the consumer calls `next()`, the iterator errors
	 * but the channel remains open.
	 *
	 * Completing the iterator (normally or via `return()`) does **not** close
	 * the channel, allowing the same channel to be iterated again. Call
	 * {@link close} or {@link abort} when the channel is no longer needed.
	 *
	 * @example
	 * const chan = await socket.request("open-stream")
	 * for await (const value of chan) {
	 *   console.log(value)
	 * }
	 * chan.close() // channel stays open after iteration; close when done
	 */
	[Symbol.asyncIterator](): AsyncIterator<unknown>

	/** Retrieve user-defined data stored on the underlying socket wrapper. */
	get(key: string): unknown

	/** Store user-defined data on the underlying socket wrapper. */
	set(key: string, value: unknown): this
}

/** Options passed to the {@link WebSocketWrapper} constructor. */
export interface WebSocketWrapperOptions {
	/**
	 * Enable debug logging (`true` uses `console.log`) or supply a custom
	 * logging function.
	 */
	debug?: boolean | ((...args: unknown[]) => void)

	/**
	 * Override the default error serialization.  The function receives an
	 * `Error` and must return a JSON string.
	 */
	errorToJSON?: (err: Error) => string

	/**
	 * Default timeout in milliseconds for all outbound requests made through
	 * this wrapper.  `0` or omitted means no timeout.
	 */
	requestTimeout?: number

	/**
	 * Optional wire encoder for ws-wrapper protocol frames. Defaults to
	 * `JSON.stringify`.
	 */
	messageEncode?: (message: Record<string, unknown>) => unknown

	/**
	 * Optional wire decoder for ws-wrapper protocol frames. Defaults to
	 * `JSON.parse`.
	 */
	messageDecode?: (data: unknown) => Record<string, unknown> | null | undefined
}

/** Thrown when an outbound request exceeds its timeout. */
export declare class RequestTimeoutError extends Error {
	name: "RequestTimeoutError"
}

/** Thrown when an outbound request is cancelled via {@link AbortSignal} or {@link WebSocketWrapper.abort}. */
export declare class RequestAbortedError extends Error {
	name: "RequestAbortedError"
	/** The abort reason from the {@link AbortSignal}, if any. */
	reason: unknown
}

/**
 * Wraps a WebSocket with socket.io-like event handling, Promise-based
 * request/response, and named channels.
 *
 * @typeParam TRemoteEvents - Events handled by the remote peer. Constrains
 *   `emit()` arguments and infers the return type of `request()`.
 * @typeParam TLocalEvents - Events handled by this side. Constrains listener
 *   types passed to `on()` and `once()`. Defaults to `TRemoteEvents`.
 *
 * @example
 * ```ts
 * import WebSocketWrapper from "ws-wrapper"
 * interface API { greet: (name: string) => string }
 * const socket = new WebSocket("wss://example.com")
 * const wrapper = new WebSocketWrapper<API>(socket)
 * wrapper.on("open", () =>
 *   wrapper.request("greet", "world").then(console.log)
 * )
 * ```
 */
export declare class WebSocketWrapper<
	TRemoteEvents extends EventMap = EventMap,
	TLocalEvents extends EventMap = TRemoteEvents,
> extends WebSocketChannel<TRemoteEvents, TLocalEvents> {
	/**
	 * Maximum number of messages to queue while the socket is not yet
	 * connected.  Attempts to send beyond this limit throw an error.
	 */
	static MAX_SEND_QUEUE_SIZE: number

	/** {@link RequestTimeoutError} class, exported for `instanceof` checks. */
	static RequestTimeoutError: typeof RequestTimeoutError

	/** {@link RequestAbortedError} class, exported for `instanceof` checks. */
	static RequestAbortedError: typeof RequestAbortedError

	/**
	 * Create a new wrapper.  If `socket` is `null` the wrapper starts
	 * unbound; call {@link bind} later to attach a socket.
	 */
	constructor(socket: WebSocketLike | null, options?: WebSocketWrapperOptions)

	/**
	 * The bound socket, or `null` if no socket is currently bound.
	 * Assigning a new value calls {@link bind}.
	 */
	socket: WebSocketLike | null

	/** `true` while the socket's `readyState` is `CONNECTING`. */
	readonly isConnecting: boolean

	/** `true` when the socket's `readyState` is `OPEN`. */
	readonly isConnected: boolean

	/** Number of outbound requests that are awaiting a response. */
	readonly pendingRequestCount: number

	/** Number of inbound requests currently being processed server-side. */
	readonly activeRequestCount: number

	/**
	 * Bind this wrapper to a new socket, replacing any previously bound socket.
	 * Any queued messages are sent immediately if the new socket is already open.
	 * Throws a `TypeError` if `socket` does not have `send` and `close` methods.
	 */
	bind(socket: WebSocketLike): this

	/**
	 * Send raw data over the WebSocket. If the socket is not yet open the
	 * data is queued and flushed once the connection opens.
	 * @param ignoreMaxQueueSize - Bypass the {@link MAX_SEND_QUEUE_SIZE} limit.
	 */
	send(data: unknown, ignoreMaxQueueSize?: boolean): this

	/**
	 * Close the underlying socket.  All arguments are forwarded to
	 * `WebSocket.close()`.
	 */
	disconnect(code?: number, reason?: string): this

	/**
	 * Immediately reject all pending outbound requests and clear the send
	 * queue. Useful when tearing down a connection without waiting for
	 * individual request timeouts. If `err` is provided and is an `Error`
	 * instance, it is used to reject all pending requests; otherwise a
	 * {@link RequestAbortedError} is used.
	 */
	abort(err?: Error): this

	/**
	 * Get (or lazily create) a {@link WebSocketChannel} for the given
	 * namespace. The returned channel shares the same event-map type
	 * parameters as this wrapper. Returns `this` when `namespace` is `null`
	 * or `undefined`. Throws a `TypeError` if `namespace` is an empty string.
	 */
	of(namespace: null | undefined): this
	of(
		namespace: string
	): WebSocketChannel<TRemoteEvents, TLocalEvents>

	/**
	 * Reserved events fired locally on the root wrapper (not sent over the
	 * wire). These overloads shadow the generic `on()` from
	 * {@link WebSocketChannel} to provide accurate argument types.
	 */
	on(
		eventName: "open" | "connect",
		listener: (event: unknown) => void
	): this
	on(
		eventName: "close" | "disconnect",
		listener: (event: unknown, wasOpen: boolean) => void
	): this
	on(eventName: "error", listener: (event: unknown) => void): this
	on(
		eventName: "message",
		listener: (event: { data: unknown }, data: unknown) => void
	): this
	on<K extends keyof TLocalEvents & string>(
		eventName: K,
		listener: TLocalEvents[K]
	): this
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	on(eventName: string, listener: (...args: any[]) => any): this

	/** Reserved-event overloads for {@link once}. */
	once(
		eventName: "open" | "connect",
		listener: (event: unknown) => void
	): this
	once(
		eventName: "close" | "disconnect",
		listener: (event: unknown, wasOpen: boolean) => void
	): this
	once(eventName: "error", listener: (event: unknown) => void): this
	once(
		eventName: "message",
		listener: (event: { data: unknown }, data: unknown) => void
	): this
	once<K extends keyof TLocalEvents & string>(
		eventName: K,
		listener: TLocalEvents[K]
	): this
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	once(eventName: string, listener: (...args: any[]) => any): this
}

export default WebSocketWrapper

/**
 * Wraps an event handler function so that if it returns a sync or async
 * iterable (or a Promise that resolves to one), the values are streamed to the
 * requestor via an anonymous channel using the async iterator protocol. Each
 * yielded value is emitted as a `"next"` event with `{value, done: false}`.
 * When the iterable is exhausted, a final `"next"` with
 * `{value: undefined, done: true}` is emitted and the channel is closed.
 *
 * If the handler does not return a sync or async iterable, the request
 * Promise is rejected with a `TypeError`.
 *
 * Since the stream is one-way (handler → requestor), `yield` expressions in
 * generator handlers always evaluate to `undefined`.
 *
 * Declare the corresponding entry in your event map with a return type of
 * `Promise<WebSocketChannel>` so that `request()` infers the resolved type
 * correctly:
 * ```ts
 * interface ServerEvents {
 *   streamNumbers: () => Promise<WebSocketChannel>
 * }
 * socket.on("streamNumbers", iterableHandler(function* () {
 *   for (let i = 1; i <= 100; i++) yield i
 * }))
 * ```
 *
 * @typeParam T - The type of values yielded by the iterable.
 *
 * @example
 * socket.on("data-stream", iterableHandler(function* (filter) {
 *   for (const item of allItems.filter(filter)) {
 *     yield item
 *   }
 * }))
 */
export function iterableHandler<T = unknown>(
	fn: (
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		...args: any[]
	) =>
		| Iterable<T>
		| AsyncIterable<T>
		| Promise<Iterable<T> | AsyncIterable<T>>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): (...args: any[]) => Promise<WebSocketChannel>
