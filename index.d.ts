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
 * A namespaced channel backed by a {@link WebSocketWrapper}.
 * Exposes an EventEmitter-like API scoped to a channel name.
 */
export declare class WebSocketChannel {
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
	 * For reserved events (`open`, `close`, `error`, etc.) on the root wrapper
	 * the listener receives the raw socket event object.  For all other events
	 * the listener is called with the deserialized arguments from the remote peer.
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
	on(eventName: string, listener: (...args: unknown[]) => unknown): this
	/** Alias for {@link on}. */
	addListener(
		eventName: string,
		listener: (...args: unknown[]) => unknown
	): this

	/** Register a one-time event listener that is removed after it fires once. */
	once(eventName: string, listener: (...args: unknown[]) => unknown): this

	/** Remove a previously registered listener. */
	removeListener(
		eventName: string,
		listener: (...args: unknown[]) => unknown
	): this
	/** Alias for {@link removeListener}. */
	off(eventName: string, listener: (...args: unknown[]) => unknown): this

	/** Remove all listeners for `eventName`, or for all events if omitted. */
	removeAllListeners(eventName?: string): this

	/** Returns the names of all events that have registered listeners. */
	eventNames(): string[]

	/** Returns the listeners registered for `eventName`. */
	listeners(eventName: string): ((...args: unknown[]) => unknown)[]

	/**
	 * Emit an event to the remote peer over the WebSocket.
	 * For reserved events on the root wrapper, emits locally instead.
	 * Throws if the channel has been closed.
	 */
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
	 * with the response value or with an anonymous {@link WebSocketChannel}
	 * if the handler returned one. Rejects with {@link RequestTimeoutError}
	 * on timeout, or {@link RequestAbortedError} if cancelled.
	 * Throws if the channel has been closed.
	 */
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
 * @example
 * ```js
 * import WebSocketWrapper from "ws-wrapper"
 * const socket = new WebSocket("wss://example.com")
 * const wrapper = new WebSocketWrapper(socket)
 * wrapper.on("open", () => wrapper.request("greet", "world").then(console.log))
 * ```
 */
export declare class WebSocketWrapper extends WebSocketChannel {
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
	 * The bound socket.  Assigning a new value calls {@link bind}.
	 */
	socket: WebSocketLike

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
	 * individual request timeouts. The optional `err` parameter is accepted
	 * for API compatibility with {@link WebSocketChannel.abort} but is ignored.
	 */
	abort(err?: Error): this

	/**
	 * Get (or lazily create) a {@link WebSocketChannel} for the given
	 * namespace.  Returns `this` when `namespace` is `null` or `undefined`.
	 */
	of(namespace: string | null | undefined): WebSocketChannel
}

export default WebSocketWrapper

/**
 * Wraps an event handler function so that if it returns a sync or async
 * iterable, the values are streamed to the requestor via an anonymous channel
 * using the async iterator protocol. Each yielded value is emitted as a
 * `"next"` event with `{value, done: false}`. When the iterable is exhausted,
 * a final `"next"` with `{value: undefined, done: true}` is emitted and the
 * channel is closed.
 *
 * If the handler does not return a sync or async iterable Object, the request
 * Promise is rejected with a `TypeError`.
 *
 * Since the stream is one-way (handler → requestor), `yield` expressions in
 * generator handlers always evaluate to `undefined`.
 *
 * @example
 * socket.on("data-stream", iterableHandler(function* (filter) {
 *   for (const item of allItems.filter(filter)) {
 *     yield item
 *   }
 * }))
 */
export function iterableHandler(
	fn: (...args: unknown[]) => Iterable<unknown> | AsyncIterable<unknown>
): (...args: unknown[]) => unknown
