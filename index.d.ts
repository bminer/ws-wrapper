/**
 * A minimal WebSocket-like interface accepted by WebSocketWrapper.
 * Compatible with the browser's native WebSocket and the `ws` npm package.
 */
export interface WebSocketLike {
	readonly readyState: number
	send(data: string): void
	close(code?: number, reason?: string): void
	onopen: ((event: unknown) => void) | null
	onmessage: ((event: { data: string }) => void) | null
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
	 * Register a persistent event listener.
	 * For reserved events (`open`, `close`, `error`, etc.) on the root wrapper
	 * the listener receives the raw socket event object.  For all other events
	 * the listener is called with the deserialized arguments from the remote peer.
	 */
	on(eventName: string, listener: (...args: unknown[]) => unknown): this
	/** Alias for {@link on}. */
	addListener(eventName: string, listener: (...args: unknown[]) => unknown): this

	/** Register a one-time event listener that is removed after it fires once. */
	once(eventName: string, listener: (...args: unknown[]) => unknown): this

	/** Remove a previously registered listener. */
	removeListener(eventName: string, listener: (...args: unknown[]) => unknown): this
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
	 */
	emit(eventName: string, ...args: unknown[]): void

	/**
	 * Set a one-shot timeout (ms) for the next {@link request} call only.
	 * Overrides the wrapper-level `requestTimeout` option for that request.
	 * @returns This channel for chaining.
	 */
	timeout(ms: number): this

	/**
	 * Attach an {@link AbortSignal} to the next {@link request} call only.
	 * If the signal is aborted before a response arrives the request is
	 * cancelled and the returned Promise rejects with {@link RequestAbortedError}.
	 * @returns This channel for chaining.
	 */
	signal(abortSignal: AbortSignal): this

	/**
	 * Send a request to the remote peer and return a Promise that resolves with
	 * the response value.  Rejects with {@link RequestTimeoutError} on timeout,
	 * or {@link RequestAbortedError} if the request is cancelled.
	 */
	request(eventName: string, ...args: unknown[]): Promise<unknown>

	/**
	 * Add a middleware function for this channel.  Middleware runs before event
	 * handlers and can inspect, modify, or block incoming events by calling
	 * `next(err)`.
	 * @returns This channel for chaining.
	 */
	use(fn: MiddlewareFn): this

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
	 * Send a raw string over the WebSocket.  If the socket is not yet open the
	 * data is queued and flushed once the connection opens.
	 * @param ignoreMaxQueueSize - Bypass the {@link MAX_SEND_QUEUE_SIZE} limit.
	 */
	send(data: string, ignoreMaxQueueSize?: boolean): this

	/**
	 * Close the underlying socket.  All arguments are forwarded to
	 * `WebSocket.close()`.
	 */
	disconnect(code?: number, reason?: string): this

	/**
	 * Immediately reject all pending outbound requests and clear the send
	 * queue.  Useful when tearing down a connection without waiting for
	 * individual request timeouts.
	 */
	abort(): this

	/**
	 * Get (or lazily create) a {@link WebSocketChannel} for the given
	 * namespace.  Returns `this` when `namespace` is `null` or `undefined`.
	 */
	of(namespace: string | null | undefined): WebSocketChannel
}

export default WebSocketWrapper
