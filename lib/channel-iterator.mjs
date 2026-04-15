import WebSocketChannel from "./channel.mjs"

/**
 * Implements the async iterator protocol on WebSocketChannel for one-way
 * streaming. The remote peer drives the stream by emitting "next" events on
 * the channel with `{value, done}` payloads.
 *
 * On the first call to `iterator.next()`, a `"start"` event is emitted on the
 * channel so the remote knows the consumer is ready:
 *
 *   chan.on("start", () => {
 *     chan.emit("next", { value: 42, done: false })
 *     chan.emit("next", { value: undefined, done: true })
 *   })
 *
 * The iterator buffers at most one unconsumed item. If a second "next" event
 * arrives before the consumer has called `iterator.next()`, the iterator
 * errors with a buffer overflow, but the channel itself is left open.
 *
 * Completing the iterator via normal completion or `iterator.return()` does
 * NOT close the channel, allowing the same channel to be iterated again.
 * Each call to `[Symbol.asyncIterator]()` creates a fresh iterator that emits
 * a new `"start"` event on the first `next()` call. Simultaneous iterators on
 * the same channel are not supported.
 *
 * Calling `iterator.throw(err)` aborts the channel (anonymous channels only),
 * closing it and signalling the remote end to clean up.
 *
 * @returns {AsyncIterator}
 */
WebSocketChannel.prototype[Symbol.asyncIterator] = function () {
	const chan = this
	const { closeSignal } = chan

	let started = false
	/** @type {{resolve: Function, reject: Function} | null} */
	let pending = null
	/** @type {{value: unknown, done: boolean} | null} */
	let buffer = null
	/** @type {Error | null} */
	let bufferError = null
	let done = closeSignal ? closeSignal.aborted : false

	function cleanup() {
		if (closeSignal) {
			closeSignal.removeEventListener("abort", onAbort)
		}
		chan.removeListener("next", onNext)
		done = true
	}

	function onAbort() {
		if (done) return
		cleanup()
		buffer = null
		const err = new Error("channel closed before iteration completed")
		if (pending) {
			const { reject } = pending
			pending = null
			reject(err)
		} else {
			bufferError = err
		}
	}

	function onNext(data) {
		if (done) return
		const isDone = !!(data && data.done)
		const value = data && data.value
		if (pending) {
			// Resolve promise returned by `next()`
			const { resolve } = pending
			pending = null
			if (isDone) {
				cleanup()
			}
			resolve({ value, done: isDone })
		} else if (buffer == null && bufferError == null) {
			// Buffer for subsequent `next()` call
			buffer = { value, done: isDone }
			if (isDone) {
				cleanup()
			}
		} else {
			// Buffer overflow: consumer is too slow
			cleanup()
			buffer = null
			bufferError = new Error(
				"async iterator buffer overflow; consumer is too slow"
			)
		}
	}

	if (!done) {
		if (closeSignal) {
			closeSignal.addEventListener("abort", onAbort, { once: true })
		}
		chan.on("next", onNext)
	}

	return {
		next() {
			// Handle user calling `next()` before previous Promise resolves
			if (pending) {
				throw new Error("cannot call next() concurrently")
			}
			// Emit "start" signal if we haven't already
			if (!started) {
				started = true
				if (!done) chan.emit("start")
			}
			// Always empty the bufferError / buffer first
			if (bufferError) {
				const err = bufferError
				bufferError = null
				return Promise.reject(err)
			}
			if (buffer) {
				const result = buffer
				buffer = null
				return Promise.resolve(result)
			}
			// Handle `done` case
			if (done) {
				return Promise.resolve({ value: undefined, done: true })
			}
			// Return promise that resolves when "next" event is received
			return new Promise((resolve, reject) => {
				pending = { resolve, reject }
			})
		},
		return() {
			if (!done) {
				cleanup()
				bufferError = null
				buffer = null
				if (pending) {
					const { resolve } = pending
					pending = null
					resolve({ value: undefined, done: true })
				}
			}
			return Promise.resolve({ value: undefined, done: true })
		},
		throw(err) {
			if (!done) {
				cleanup()
				bufferError = null
				buffer = null
				if (pending) {
					const { reject } = pending
					pending = null
					reject(err)
				}
				// For anonymous channels, abort() sends {h, x} to notify remote.
				// For non-anonymous channels this is a no-op.
				chan.abort(err)
			}
			return Promise.reject(err)
		},
		[Symbol.asyncIterator]() {
			return this
		},
	}
}
