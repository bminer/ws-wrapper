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
 * @param {Function} fn - Event handler that returns a sync or async iterable
 * @returns {Function} Wrapped handler suitable for use with `channel.on()`
 *
 * @example
 * // Sync generator
 * socket.on("data-stream", iterableHandler(function* (filter) {
 *   for (const item of allItems.filter(filter)) {
 *     yield item
 *   }
 * }))
 *
 * @example
 * // Async generator
 * socket.on("data-stream", iterableHandler(async function* (filter) {
 *   for await (const item of asyncSource) {
 *     yield item
 *   }
 * }))
 */
export function iterableHandler(fn) {
	if (typeof fn !== "function") {
		throw new TypeError("iterableHandler: fn must be a function")
	}
	return async function () {
		const result = await fn.apply(this, arguments)
		if (
			result == null ||
			(typeof result !== "object" && typeof result !== "function") ||
			(!(Symbol.asyncIterator in result) && !(Symbol.iterator in result))
		) {
			throw new TypeError(
				"iterableHandler: handler must return a sync or async iterable"
			)
		}
		const chan = this.channel()
		chan.on("start", async () => {
			try {
				for await (const value of result) {
					if (chan.closeSignal?.aborted) return
					chan.emit("next", { value, done: false })
				}
				if (!chan.closeSignal?.aborted) {
					chan.emit("next", { value: undefined, done: true })
					chan.close()
				}
			} catch (err) {
				chan.abort(err)
			}
		})
		return chan
	}
}
