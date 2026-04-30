import { strict as assert } from "assert"
import test from "node:test"
import "../lib/channel-iterator.mjs"
import { iterableHandler } from "../lib/iterable-handler.mjs"
import WebSocketWrapper from "../lib/wrapper.mjs"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake socket. readyState defaults to OPEN (1). */
function makeSocket(opts) {
	opts = opts || {}
	const sent = []
	const socket = {
		constructor: { OPEN: 1, CONNECTING: 0 },
		readyState: opts.readyState != null ? opts.readyState : 1,
		sent,
		send(msg) {
			sent.push(msg)
		},
		close() {},
	}
	return socket
}

/** Parse the most-recently sent message. */
function lastSent(socket) {
	return JSON.parse(socket.sent[socket.sent.length - 1])
}

// ---------------------------------------------------------------------------
// bind() validation
// ---------------------------------------------------------------------------

test("bind() throws on invalid socket", () => {
	const wrapper = new WebSocketWrapper(null, {})
	assert.throws(() => wrapper.bind(null), TypeError)
	assert.throws(() => wrapper.bind({}), TypeError)
	assert.throws(() => wrapper.bind({ send: "not a fn", close() {} }), TypeError)
})

// ---------------------------------------------------------------------------
// Pending send queue
// ---------------------------------------------------------------------------

test("messages are queued when socket is not connected", () => {
	const wrapper = new WebSocketWrapper(null, {})
	wrapper.send("m1")
	wrapper.send("m2")
	assert.deepEqual(wrapper._pendingSend, ["m1", "m2"])
})

test("queue is flushed in FIFO order on socket open", () => {
	const wrapper = new WebSocketWrapper(null, {})
	wrapper.send("m1")
	wrapper.send("m2")
	const socket = makeSocket({ readyState: 0 }) // CONNECTING
	assert.deepEqual(socket.sent, [])
	wrapper.bind(socket)
	socket.readyState = 1
	socket.onopen({})
	assert.deepEqual(socket.sent, ["m1", "m2"])
	assert.equal(wrapper._pendingSend.length, 0)
})

test("failed send during flush preserves message order in the queue", () => {
	const wrapper = new WebSocketWrapper(null, {})
	wrapper.send("m1")
	wrapper.send("m2")
	let calls = 0
	const socket = makeSocket({ readyState: 0 })
	socket.send = function (msg) {
		if (++calls === 1) throw new Error("send failed")
		this.sent.push(msg)
	}
	wrapper.bind(socket)
	socket.readyState = 1
	let threw = false
	try {
		socket.onopen({})
	} catch (ignore) {
		threw = true
	}
	assert.ok(threw, "should re-throw the send error")
	// m1 failed; queue should retain m1 followed by m2 (original order preserved)
	assert.deepEqual(wrapper._pendingSend, ["m1", "m2"])
})

test("send queue throws when full and not connected", () => {
	const wrapper = new WebSocketWrapper(null, {})
	for (let i = 0; i < WebSocketWrapper.MAX_SEND_QUEUE_SIZE; i++) {
		wrapper.send(`m${i}`)
	}
	assert.throws(() => wrapper.send("overflow"), /send queue is full/)
})

// ---------------------------------------------------------------------------
// Request / response round-trip
// ---------------------------------------------------------------------------

test("request resolves with response data", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("ping", "arg1")
	const { i: reqId } = lastSent(socket)
	wrapper._onMessage(JSON.stringify({ i: reqId, d: "pong" }))
	assert.equal(await p, "pong")
})

test("request rejects when remote sends an Error", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("fail")
	const { i: reqId } = lastSent(socket)
	wrapper._onMessage(JSON.stringify({ i: reqId, e: { message: "oops" }, _: 1 }))
	await assert.rejects(
		p,
		(err) => err instanceof Error && err.message === "oops"
	)
})

test("request rejects when remote sends a plain string error", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("fail")
	const { i: reqId } = lastSent(socket)
	wrapper._onMessage(JSON.stringify({ i: reqId, e: "something went wrong" }))
	// Plain strings are passed through as-is (not wrapped in Error)
	await assert.rejects(p, (err) => err === "something went wrong")
})

test("request rejects when remote sends an empty string error", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("fail")
	const { i: reqId } = lastSent(socket)
	wrapper._onMessage(JSON.stringify({ i: reqId, e: "" }))
	// Empty string is passed through as-is (not wrapped in Error)
	await assert.rejects(p, (err) => err === "")
})

test("request rejects with raw value when e is a plain object (no _ flag)", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("fail")
	const { i: reqId } = lastSent(socket)
	wrapper._onMessage(JSON.stringify({ i: reqId, e: { code: 42 } }))
	await assert.rejects(p, (err) => err.code === 42 && !(err instanceof Error))
})

// ---------------------------------------------------------------------------
// Timeouts
// ---------------------------------------------------------------------------

test("requestTimeout option rejects with RequestTimeoutError", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, { requestTimeout: 20 })
	await assert.rejects(
		wrapper.request("slow"),
		(err) => err.name === "RequestTimeoutError"
	)
})

test("per-request timeout via .timeout() overrides global default", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, { requestTimeout: 5000 })
	await assert.rejects(
		wrapper.timeout(20).request("slow"),
		(err) => err.name === "RequestTimeoutError"
	)
})

test("timeout sends a cancellation message to the remote", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, { requestTimeout: 20 })
	const p = wrapper.request("slow")
	const reqId = JSON.parse(socket.sent[0]).i
	await assert.rejects(p, (err) => err.name === "RequestTimeoutError")
	// A cancellation frame should have been sent
	const cancel = socket.sent.map(JSON.parse).find((m) => "x" in m)
	assert.ok(cancel, "cancellation message should be sent")
	assert.equal(cancel.i, reqId)
	// x should be a serialized RequestAbortedError with _ flag
	assert.equal(cancel._, 1, "x should be flagged as a JS Error")
	assert.equal(typeof cancel.x, "object", "x should be an Error object")
	assert.equal(cancel.x.message, "Request aborted")
})

// ---------------------------------------------------------------------------
// AbortSignal
// ---------------------------------------------------------------------------

test("signal already aborted rejects immediately without sending", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const signal = { aborted: true, reason: "cancelled" }
	await assert.rejects(
		wrapper.signal(signal).request("noop"),
		(err) => err.name === "RequestAbortedError"
	)
	assert.equal(socket.sent.length, 0, "no message should be sent")
})

// ---------------------------------------------------------------------------
// Inbound request cancellation
// ---------------------------------------------------------------------------

test("inbound cancellation aborts the active request handler", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	// Simulate being the server: register a slow handler that never replies
	wrapper.on("doWork", function () {
		return new Promise(() => {}) // never resolves
	})
	wrapper._onMessage(JSON.stringify({ a: ["doWork"], i: 7 }))
	if (typeof AbortController === "function") {
		assert.ok(wrapper._activeRequests[7], "should track active request")
		wrapper._onMessage(
			JSON.stringify({ x: { message: "Request aborted" }, _: 1, i: 7 })
		)
		assert.equal(
			wrapper._activeRequests[7],
			undefined,
			"active request should be cleaned up after cancellation"
		)
	}
})

test("signal abort with string reason sends that string in x", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const ac = new AbortController()
	const p = wrapper.signal(ac.signal).request("slow")
	const reqId = JSON.parse(socket.sent[0]).i
	ac.abort("user cancelled")
	await assert.rejects(p, (err) => err.name === "RequestAbortedError")
	const cancel = socket.sent.map(JSON.parse).find((m) => "x" in m)
	assert.ok(cancel, "cancellation message should be sent")
	assert.equal(cancel.i, reqId)
	assert.equal(cancel.x, "user cancelled")
	assert.equal(
		cancel._,
		undefined,
		"_ flag should not be set for a string reason"
	)
})

test("signal abort with Error reason sends serialized Error in x with _ flag", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const ac = new AbortController()
	const p = wrapper.signal(ac.signal).request("slow")
	const reqId = JSON.parse(socket.sent[0]).i
	ac.abort(new Error("user error"))
	await assert.rejects(p, (err) => err.name === "RequestAbortedError")
	const cancel = socket.sent.map(JSON.parse).find((m) => "x" in m)
	assert.ok(cancel, "cancellation message should be sent")
	assert.equal(cancel.i, reqId)
	assert.equal(cancel._, 1, "_ should be set for Error reason")
	assert.equal(typeof cancel.x, "object")
	assert.equal(cancel.x.message, "user error")
})

test("signal abort with no explicit reason sends a cancel message with an Error", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const ac = new AbortController()
	const p = wrapper.signal(ac.signal).request("slow")
	const reqId = JSON.parse(socket.sent[0]).i
	ac.abort() // no reason — runtime supplies a default (e.g. DOMException in Node.js)
	await assert.rejects(p, (err) => err.name === "RequestAbortedError")
	const cancel = socket.sent.map(JSON.parse).find((m) => "x" in m)
	assert.ok(cancel, "cancellation message should be sent")
	assert.equal(cancel.i, reqId)
	assert.equal(
		cancel._,
		1,
		"_ should be set because reason is an Error-like object"
	)
	assert.equal(typeof cancel.x, "object")
})

test("signal abort with plain object reason sends object in x without _ flag", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const ac = new AbortController()
	const p = wrapper.signal(ac.signal).request("slow")
	const reqId = JSON.parse(socket.sent[0]).i
	ac.abort({ code: 42 })
	await assert.rejects(p, (err) => err.name === "RequestAbortedError")
	const cancel = socket.sent.map(JSON.parse).find((m) => "x" in m)
	assert.ok(cancel, "cancellation message should be sent")
	assert.equal(cancel.i, reqId)
	assert.equal(
		cancel._,
		undefined,
		"_ should not be set for plain object reason"
	)
	assert.deepEqual(cancel.x, { code: 42 })
})

test("inbound cancel with plain object reason passes it as-is to signal.reason", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	let capturedSignal = null
	wrapper.on("doWork", function () {
		capturedSignal = this.signal
		return new Promise(() => {})
	})
	wrapper._onMessage(JSON.stringify({ a: ["doWork"], i: 10 }))
	if (typeof AbortController === "function") {
		wrapper._onMessage(JSON.stringify({ x: { code: 42 }, i: 10 }))
		assert.equal(capturedSignal.aborted, true)
		assert.deepEqual(capturedSignal.reason, { code: 42 })
	}
})

test("inbound cancel with string reason propagates to signal.reason", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	let capturedSignal = null
	wrapper.on("doWork", function () {
		capturedSignal = this.signal
		return new Promise(() => {})
	})
	wrapper._onMessage(JSON.stringify({ a: ["doWork"], i: 8 }))
	if (typeof AbortController === "function") {
		wrapper._onMessage(JSON.stringify({ x: "user cancelled", i: 8 }))
		assert.equal(capturedSignal.aborted, true)
		assert.equal(capturedSignal.reason, "user cancelled")
	}
})

test("inbound cancel with Error reason reconstructs an Error on signal.reason", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	let capturedSignal = null
	wrapper.on("doWork", function () {
		capturedSignal = this.signal
		return new Promise(() => {})
	})
	wrapper._onMessage(JSON.stringify({ a: ["doWork"], i: 9 }))
	if (typeof AbortController === "function") {
		wrapper._onMessage(
			JSON.stringify({
				x: { message: "user error", name: "Error" },
				_: 1,
				i: 9,
			})
		)
		assert.equal(capturedSignal.aborted, true)
		assert.ok(capturedSignal.reason instanceof Error)
		assert.equal(capturedSignal.reason.message, "user error")
	}
})

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

test("of() returns the same channel instance for a given name", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	assert.equal(wrapper.of("chat"), wrapper.of("chat"))
})

test("of(null) returns the wrapper itself", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	assert.equal(wrapper.of(null), wrapper)
})

test("channel routes inbound events to the correct channel", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const ch = wrapper.of("chat")
	let received = null
	ch.on("msg", function (text) {
		received = text
	})
	wrapper._onMessage(JSON.stringify({ a: ["msg", "hello"], c: "chat" }))
	assert.equal(received, "hello")
})

test("inbound event for a non-existent channel sends rejection", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper._onMessage(JSON.stringify({ a: ["greet"], c: "noSuchChannel", i: 3 }))
	const reply = lastSent(socket)
	assert.equal(reply.i, 3)
	assert.ok(reply.e, "should send an error back for the unknown channel")
})

// ---------------------------------------------------------------------------
// channel.close()
// ---------------------------------------------------------------------------

test("channel.close() removes the channel from the wrapper", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const ch = wrapper.of("chat")
	ch.close()
	assert.notEqual(
		wrapper.of("chat"),
		ch,
		"of() should return a new instance after close"
	)
})

test("channel.close() clears registered listeners", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const ch = wrapper.of("chat")
	ch.on("msg", () => {})
	ch.close()
	assert.deepEqual(ch.eventNames(), [])
})

test("channel.close() clears middleware", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const ch = wrapper.of("chat")
	ch.use((_name, _args, next) => next())
	ch.close()
	assert.equal(ch._middleware.length, 0)
})

test("inbound request to a closed channel sends rejection with channel-not-found error", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const ch = wrapper.of("chat")
	ch.on("greet", () => "hello")
	ch.close()
	wrapper._onMessage(JSON.stringify({ a: ["greet"], c: "chat", i: 7 }))
	const reply = lastSent(socket)
	assert.equal(reply.i, 7)
	assert.ok(reply.e, "should send a rejection for the closed channel")
	assert.match(reply.e.message, /channel/i)
})

test("inbound simple event to a closed channel is silently dropped (no rejection)", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const ch = wrapper.of("chat")
	ch.on("msg", () => {})
	ch.close()
	const sentBefore = socket.sent.length
	wrapper._onMessage(JSON.stringify({ a: ["msg", "hello"], c: "chat" }))
	assert.equal(
		socket.sent.length,
		sentBefore,
		"no reply should be sent for a simple event"
	)
})

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

test("middleware can block events", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	let handlerCalled = false
	wrapper.on("secret", () => {
		handlerCalled = true
	})
	wrapper.use((_name, _args, next) => {
		next(new Error("blocked"))
	})
	wrapper._onMessage(JSON.stringify({ a: ["secret"] }))
	assert.equal(handlerCalled, false)
})

test("middleware passes events through when next() is called without error", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	let handlerCalled = false
	wrapper.on("hello", () => {
		handlerCalled = true
	})
	wrapper.use((_name, _args, next) => {
		next()
	})
	wrapper._onMessage(JSON.stringify({ a: ["hello"] }))
	assert.equal(handlerCalled, true)
})

test("use() is chainable", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const result = wrapper.use(() => {}).use(() => {})
	assert.equal(result, wrapper)
})

// ---------------------------------------------------------------------------
// abort()
// ---------------------------------------------------------------------------

test("abort() rejects all pending requests", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p1 = wrapper.request("a")
	const p2 = wrapper.request("b")
	wrapper.abort()
	await assert.rejects(p1, (err) => err.name === "RequestAbortedError")
	await assert.rejects(p2, (err) => err.name === "RequestAbortedError")
})

test("abort(err) rejects all pending requests with the provided error", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p1 = wrapper.request("a")
	const p2 = wrapper.request("b")
	const customErr = new Error("connection lost")
	wrapper.abort(customErr)
	await assert.rejects(p1, (err) => err === customErr)
	await assert.rejects(p2, (err) => err === customErr)
})

test("abort() with non-Error argument falls back to RequestAbortedError", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p1 = wrapper.request("a")
	wrapper.abort("not an error")
	await assert.rejects(p1, (err) => err.name === "RequestAbortedError")
})

test("abort() clears the pending send queue", () => {
	const wrapper = new WebSocketWrapper(null, {})
	wrapper.send("queued")
	wrapper.abort()
	assert.equal(wrapper._pendingSend.length, 0)
})

// ---------------------------------------------------------------------------
// Miscellaneous
// ---------------------------------------------------------------------------

test("non-JSON messages are silently ignored", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	assert.doesNotThrow(() => wrapper._onMessage("not json at all"))
	assert.doesNotThrow(() => wrapper._onMessage(""))
})

test("messages with ws-wrapper:false are ignored", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	let called = false
	wrapper.on("test", () => {
		called = true
	})
	wrapper._onMessage(JSON.stringify({ "ws-wrapper": false, a: ["test"] }))
	assert.equal(called, false)
})

test("custom messageEncode is used for outbound protocol frames", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {
		messageEncode(msg) {
			return `bin:${JSON.stringify(msg)}`
		},
	})
	wrapper.emit("hello", "world")
	assert.equal(typeof socket.sent[0], "string")
	assert.equal(socket.sent[0].startsWith("bin:"), true)
	assert.deepEqual(JSON.parse(socket.sent[0].slice(4)), {
		a: ["hello", "world"],
	})
})

test("custom messageDecode is used for inbound protocol frames", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {
		messageDecode(data) {
			return JSON.parse(Buffer.from(data).toString("utf8"))
		},
	})
	let value
	wrapper.on("hello", (msg) => {
		value = msg
	})
	wrapper._onMessage(Buffer.from(JSON.stringify({ a: ["hello", "world"] })))
	assert.equal(value, "world")
})

test("custom messageDecode ignores falsy decoded payloads", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {
		messageDecode() {
			return null
		},
	})
	let called = false
	wrapper.on("hello", () => {
		called = true
	})
	assert.doesNotThrow(() => wrapper._onMessage("ignored"))
	assert.equal(called, false)
})

test("get/set stores and retrieves arbitrary data on the wrapper", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.set("userId", 42)
	assert.equal(wrapper.get("userId"), 42)
})

test("pendingRequestCount reflects outstanding requests", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	assert.equal(wrapper.pendingRequestCount, 0)
	const p = wrapper.request("slow")
	assert.equal(wrapper.pendingRequestCount, 1)
	const { i: reqId } = lastSent(socket)
	wrapper._onMessage(JSON.stringify({ i: reqId, d: "done" }))
	await p
	assert.equal(wrapper.pendingRequestCount, 0)
})

// ---------------------------------------------------------------------------
// isConnected / isConnecting
// ---------------------------------------------------------------------------

test("isConnected is true for an open socket", () => {
	const socket = makeSocket() // readyState = 1 (OPEN)
	const wrapper = new WebSocketWrapper(socket, {})
	assert.equal(wrapper.isConnected, true)
	assert.equal(wrapper.isConnecting, false)
})

test("isConnecting is true for a connecting socket", () => {
	const socket = makeSocket({ readyState: 0 }) // CONNECTING
	const wrapper = new WebSocketWrapper(socket, {})
	assert.equal(wrapper.isConnecting, true)
	assert.equal(wrapper.isConnected, false)
})

test("isConnected and isConnecting are false with no socket", () => {
	const wrapper = new WebSocketWrapper(null, {})
	assert.equal(wrapper.isConnected, false)
	assert.equal(wrapper.isConnecting, false)
})

// ---------------------------------------------------------------------------
// bind() with already-open socket
// ---------------------------------------------------------------------------

test("bind() with already-open socket flushes pending messages immediately", () => {
	const wrapper = new WebSocketWrapper(null, {})
	wrapper.send("pending-msg")
	const socket = makeSocket() // readyState = 1 (OPEN)
	wrapper.bind(socket)
	assert.ok(socket.sent.includes("pending-msg"))
	assert.equal(wrapper._pendingSend.length, 0)
})

// ---------------------------------------------------------------------------
// disconnect()
// ---------------------------------------------------------------------------

test("disconnect() forwards arguments to socket.close()", () => {
	let closedWith = null
	let reason = null
	const socket = makeSocket()
	socket.close = function (code, r) {
		closedWith = code
		reason = r
	}
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.disconnect(1000, "just because")
	assert.equal(closedWith, 1000)
	assert.equal(reason, "just because")
})

test("WebSocketWrapper.close() delegates to disconnect()", () => {
	let closed = false
	const socket = makeSocket()
	socket.close = function () {
		closed = true
	}
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.close()
	assert.equal(closed, true)
})

// ---------------------------------------------------------------------------
// Server-side request handling
// ---------------------------------------------------------------------------

test("handler returning a sync value sends it as the response", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.on("echo", (msg) => msg)
	wrapper._onMessage(JSON.stringify({ a: ["echo", "hello"], i: 10 }))
	const reply = lastSent(socket)
	assert.equal(reply.i, 10)
	assert.equal(reply.d, "hello")
})

test("handler returning a Promise sends the resolved value as the response", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.on("compute", async () => "async-result")
	wrapper._onMessage(JSON.stringify({ a: ["compute"], i: 11 }))
	await Promise.resolve()
	await Promise.resolve()
	const reply = lastSent(socket)
	assert.equal(reply.i, 11)
	assert.equal(reply.d, "async-result")
})

test("handler that throws sends an error response", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.on("boom", () => {
		throw new Error("handler blew up")
	})
	wrapper._onMessage(JSON.stringify({ a: ["boom"], i: 12 }))
	const reply = lastSent(socket)
	assert.equal(reply.i, 12)
	assert.ok(reply.e, "should have error payload")
	assert.equal(reply._, 1, "should flag as Error instance")
	assert.equal(reply.e.message, "handler blew up")
})

test("handler returning a rejected Promise sends an error response", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.on("asyncBoom", async () => {
		throw new Error("async failure")
	})
	wrapper._onMessage(JSON.stringify({ a: ["asyncBoom"], i: 13 }))
	await Promise.resolve()
	await Promise.resolve()
	const reply = lastSent(socket)
	assert.equal(reply.i, 13)
	assert.ok(reply.e)
	assert.equal(reply.e.message, "async failure")
})

test("handler that throws null sends a default Error (null is not round-trip safe)", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.on("nullThrow", () => {
		throw null
	})
	wrapper._onMessage(JSON.stringify({ a: ["nullThrow"], i: 14 }))
	const reply = lastSent(socket)
	assert.equal(reply.i, 14)
	assert.equal(reply._, 1, "null should be replaced with a default Error")
	assert.ok(typeof reply.e === "object" && reply.e != null)
})

test("handler that throws undefined sends a default Error (undefined is not serializable)", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.on("undefThrow", () => {
		throw undefined
	})
	wrapper._onMessage(JSON.stringify({ a: ["undefThrow"], i: 15 }))
	const reply = lastSent(socket)
	assert.equal(reply.i, 15)
	assert.equal(reply._, 1, "undefined should be replaced with a default Error")
	assert.ok(typeof reply.e === "object" && reply.e != null)
})

test("handler that throws 0 sends 0 as-is", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.on("zeroThrow", () => {
		throw 0
	})
	wrapper._onMessage(JSON.stringify({ a: ["zeroThrow"], i: 16 }))
	const reply = lastSent(socket)
	assert.equal(reply.i, 16)
	assert.equal(reply._, undefined, "should not be flagged as an Error")
	assert.equal(reply.e, 0)
})

test("handler that throws an empty string sends it as-is", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.on("emptyStringThrow", () => {
		throw ""
	})
	wrapper._onMessage(JSON.stringify({ a: ["emptyStringThrow"], i: 17 }))
	const reply = lastSent(socket)
	assert.equal(reply.i, 17)
	assert.equal(reply._, undefined, "should not be flagged as an Error")
	assert.equal(reply.e, "")
})

test("handler that throws a plain object sends it as-is without _ flag", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.on("objThrow", () => {
		throw { code: 42, msg: "bad" }
	})
	wrapper._onMessage(JSON.stringify({ a: ["objThrow"], i: 18 }))
	const reply = lastSent(socket)
	assert.equal(reply.i, 18)
	assert.equal(reply._, undefined, "should not be flagged as an Error")
	assert.deepEqual(reply.e, { code: 42, msg: "bad" })
})

// ---------------------------------------------------------------------------
// once() and removeListener()
// ---------------------------------------------------------------------------

test("once() listener fires only on the first matching event", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	let count = 0
	wrapper.once("ping", () => {
		count++
	})
	wrapper._onMessage(JSON.stringify({ a: ["ping"] }))
	wrapper._onMessage(JSON.stringify({ a: ["ping"] }))
	assert.equal(count, 1)
})

test("removeListener() / off() prevents the listener from firing", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	let called = false
	const handler = () => {
		called = true
	}
	wrapper.on("hello", handler)
	wrapper.off("hello", handler)
	wrapper._onMessage(JSON.stringify({ a: ["hello"] }))
	assert.equal(called, false)
})

// ---------------------------------------------------------------------------
// Channel isolation
// ---------------------------------------------------------------------------

test("events on one channel do not bleed to another channel", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	let chatMsg = null
	let gameMsg = null
	wrapper.of("chat").on("msg", (text) => {
		chatMsg = text
	})
	wrapper.of("game").on("msg", (text) => {
		gameMsg = text
	})
	wrapper._onMessage(JSON.stringify({ a: ["msg", "hello"], c: "chat" }))
	assert.equal(chatMsg, "hello")
	assert.equal(gameMsg, null)
})

// ---------------------------------------------------------------------------
// activeRequestCount
// ---------------------------------------------------------------------------

test("activeRequestCount tracks inbound requests being processed", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	assert.equal(wrapper.activeRequestCount, 0)
	// Register a handler that never responds (simulates slow work)
	wrapper.on("slow", () => new Promise(() => {}))
	wrapper._onMessage(JSON.stringify({ a: ["slow"], i: 50 }))
	assert.equal(
		wrapper.activeRequestCount,
		typeof AbortController === "function" ? 1 : 0
	)
})

// ---------------------------------------------------------------------------
// Anonymous channels
// ---------------------------------------------------------------------------

test("handler returning this.channel() sends {i, h:1} response", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.on("open-stream", function () {
		return this.channel()
	})
	wrapper._onMessage(JSON.stringify({ a: ["open-stream"], i: 99 }))
	const reply = lastSent(socket)
	assert.equal(reply.i, 99)
	assert.equal(reply.h, 1)
	assert.equal(wrapper._anonymousChannels["99"] != null, true)
})

test("async handler returning this.channel() sends {i, h:1} response", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.on("open-stream", async function () {
		return this.channel()
	})
	wrapper._onMessage(JSON.stringify({ a: ["open-stream"], i: 77 }))
	await Promise.resolve()
	await Promise.resolve()
	// Handler is async; wait a tick for the promise to resolve
	// return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
	const reply = lastSent(socket)
	assert.equal(reply.i, 77)
	assert.equal(reply.h, 1)
	assert.ok(wrapper._anonymousChannels["77"] != null)
	// })
})

test("requestor receives a WebSocketChannel when {i, h:1} response arrives", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	// Simulate the server's {i, h:1} response
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	return p.then((chan) => {
		assert.equal(chan != null && typeof chan.on === "function", true)
		assert.equal(chan.isAnonymous, true)
		assert.equal(wrapper._anonymousChannels["1"], chan)
	})
})

test("anonymous channel events are routed via h field", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	// Simulate opening an anonymous channel on the requestor side
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	return p.then((chan) => {
		let received = null
		chan.on("data", (value) => {
			received = value
		})
		// Server emits an event on the anonymous channel
		wrapper._onMessage(JSON.stringify({ a: ["data", "hello"], h: "1" }))
		assert.equal(received, "hello")
	})
})

test("emit on anonymous channel sends h field instead of c", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	return p.then((chan) => {
		chan.emit("ack", 42)
		const msg = lastSent(socket)
		assert.equal(msg.h, "1")
		assert.equal(msg.c, undefined)
		assert.deepEqual(msg.a, ["ack", 42])
	})
})

test("emit on anonymous channel before it is open throws", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	// Create an unregistered anonymous channel directly
	const chan = new (wrapper.of("x").constructor)("99", wrapper)
	chan._isAnonymous = true
	assert.throws(() => chan.emit("test"), /closed/)
})

test("emit on a closed named channel throws", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const chan = wrapper.of("room")
	chan.close()
	assert.throws(() => chan.emit("msg", "hello"), /closed/)
})

test("channel() is not available outside a request handler", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	// channel() is only injected onto the per-request context object
	assert.equal(typeof wrapper.channel, "undefined")
	assert.equal(typeof wrapper.of("foo").channel, "undefined")
})

test("channel() always returns the same instance for the same handler", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	let called = false
	wrapper.on("test", function () {
		const c = this.channel()
		assert.strictEqual(this.channel(), c)
		called = true
	})
	wrapper._onMessage(JSON.stringify({ i: 1, a: ["test"] }))
	assert.ok(called, "event handler was not called")
})

test("close() removes anonymous channel and cleans up signals", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	return p.then((chan) => {
		assert.equal(wrapper._anonymousChannels["1"], chan)
		chan.close()
		assert.equal(wrapper._anonymousChannels["1"], undefined)
	})
})

test("inbound cancellation closes the anonymous channel on the handler side", async () => {
	// Only run where AbortController is available
	if (typeof AbortController !== "function") return
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	wrapper.on("open-stream", function () {
		return this.channel()
	})
	wrapper._onMessage(JSON.stringify({ a: ["open-stream"], i: 7 }))
	const chan = wrapper._anonymousChannels["7"]
	assert.ok(chan != null, "anonymous channel must be created")
	// {i,x} is now a no-op once the channel is open — _activeRequests[7]
	// was already cleaned up when the {i,h:1} response was sent.
	// The correct way to close the channel from the requestor is {h,x}.
	wrapper._onMessage(JSON.stringify({ i: 7, x: { message: "cancelled" } }))
	assert.ok(
		wrapper._anonymousChannels["7"] != null,
		"{i,x} should be ignored once anonymous channel is open"
	)
	assert.ok(!chan.closeSignal.aborted, "close signal must not be aborted")
	// {h,x} is the correct protocol for closing an anonymous channel
	wrapper._onMessage(
		JSON.stringify({ h: "7", x: { message: "cancelled" }, _: 1 })
	)
	assert.equal(
		wrapper._anonymousChannels["7"],
		undefined,
		"{h,x} should close the anonymous channel"
	)
	assert.ok(chan.closeSignal.aborted, "close signal must be aborted")
})

test("anonymous channel timeout aborts the request after TTL", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p
	// Set a very short TTL
	const req2P = chan.timeout(10).request("echo", "hello")
	const reqMsg = lastSent(socket)
	assert.equal(reqMsg.i, wrapper._lastRequestId)
	assert.equal(reqMsg.a.length, 2)
	assert.equal(reqMsg.a[0], "echo")
	assert.equal(reqMsg.a[1], "hello")
	assert.equal(reqMsg.h, "1")
	assert.equal(wrapper._anonymousChannels["1"], chan)
	try {
		await req2P
		assert.ok(false, "request should throw an error")
	} catch (err) {
		assert.equal(err.message, "Request timed out")
	}
	assert.equal(wrapper._anonymousChannels["1"], chan)
	// abort() should have sent {h, x} to notify the remote
	const cancelMsg = lastSent(socket)
	assert.equal(cancelMsg.i, wrapper._lastRequestId)
	assert.ok(cancelMsg.h == null, "abort message should not have `h` field")
	assert.ok(cancelMsg.x != null, "abort message should have been sent")
})

test("anonymous channel signal() aborts request, not channel", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p
	const ac = new AbortController()
	const req2P = chan.signal(ac.signal).request("echo", "hello")
	const reqMsg = lastSent(socket)
	assert.equal(reqMsg.i, wrapper._lastRequestId)
	assert.equal(reqMsg.a.length, 2)
	assert.equal(reqMsg.a[0], "echo")
	assert.equal(reqMsg.a[1], "hello")
	assert.equal(reqMsg.h, "1")
	assert.equal(wrapper._anonymousChannels["1"], chan)
	ac.abort()
	assert.equal(wrapper._anonymousChannels["1"], chan)
	try {
		await req2P
		assert.ok(false, "request should throw an error")
	} catch (err) {
		assert.equal(err.message, "Request aborted")
	}
	// abort() should have sent {h, x} to notify the remote
	const cancelMsg = lastSent(socket)
	assert.equal(cancelMsg.i, wrapper._lastRequestId)
	assert.ok(cancelMsg.x != null, "abort message should have been sent")
})

test("isAnonymous getter returns false for named channels", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	assert.equal(wrapper.of("chat").isAnonymous, false)
})

test("isAnonymous getter returns true for anonymous channels", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	return p.then((chan) => {
		assert.equal(chan.isAnonymous, true)
	})
})

test("unknown anonymous channel message sends fail-safe cancel, and rejects if it has a requestID", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	// Emit on a non-existent anonymous channel (no sub-request)
	wrapper._onMessage(JSON.stringify({ a: ["data", "x"], h: "99" }))
	const cancel = lastSent(socket)
	assert.equal(cancel.h, "99")
	assert.ok(cancel.x != null, "should send a cancel for the channel")
	// Emit with a sub-request: should also send a reject for the sub-request
	wrapper._onMessage(JSON.stringify({ a: ["data", "x"], h: "99", i: 5 }))
	const reply = lastSent(socket)
	assert.equal(reply.i, 5)
	assert.ok(
		reply.e != null,
		"should send an error response for the sub-request"
	)
})

test("close() on handler-side channel does not abort request", () => {
	if (typeof AbortController !== "function") return
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	let handlerSignal = null
	wrapper.on("open-stream", function () {
		handlerSignal = this.signal
		return this.channel()
	})
	wrapper._onMessage(JSON.stringify({ a: ["open-stream"], i: 3 }))
	const chan = wrapper._anonymousChannels["3"]
	assert.ok(chan, "anonymous channel should exist")
	assert.ok(handlerSignal, "handler should have signal")
	assert.equal(handlerSignal.aborted, false)
	chan.close()
	assert.equal(handlerSignal.aborted, false)
})

test("message to closed anonymous channel triggers fail-safe cancel to remote", () => {
	if (typeof AbortController !== "function") return
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	let chan = null
	wrapper.on("open-stream", function () {
		chan = this.channel()
		return chan
	})
	wrapper._onMessage(JSON.stringify({ a: ["open-stream"], i: 4 }))
	assert.ok(wrapper._anonymousChannels["4"], "channel should be registered")
	// Close the channel locally
	wrapper._anonymousChannels["4"].close()
	assert.equal(wrapper._anonymousChannels["4"], undefined)
	// Remote sends a "next" event after close — should trigger fail-safe cancel
	const prevSentCount = socket.sent.length
	wrapper._onMessage(
		JSON.stringify({ h: "4", a: ["next", { value: 1, done: false }] })
	)
	assert.ok(
		socket.sent.length > prevSentCount,
		"a message should have been sent"
	)
	const cancelMsg = lastSent(socket)
	assert.equal(cancelMsg.h, "4")
	assert.ok(cancelMsg.x != null, "fail-safe cancel should have been sent")
})

test("chan.abort() sends cancel and closes requestor-side anonymous channel", async () => {
	if (typeof AbortController !== "function") return
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p
	assert.ok(wrapper._anonymousChannels["1"], "channel should exist")
	const err = new Error("user aborted")
	chan.abort(err)
	assert.equal(
		wrapper._anonymousChannels["1"],
		undefined,
		"channel should be closed"
	)
	const cancelMsg = lastSent(socket)
	assert.equal(cancelMsg.h, "1")
	assert.ok(cancelMsg.x != null, "cancel message should have been sent")
})

test("handler-side cancel closes requestor-side anonymous channel", async () => {
	if (typeof AbortController !== "function") return
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	await p
	assert.ok(wrapper._anonymousChannels["1"], "channel should exist")
	// Simulate handler side sending an anonymous channel abort message
	wrapper._onMessage(
		JSON.stringify({ h: "1", x: { message: "handler aborted" }, _: 1 })
	)
	assert.equal(
		wrapper._anonymousChannels["1"],
		undefined,
		"channel should be closed by inbound cancel"
	)
})

// ---------------------------------------------------------------------------
// Async iterator ([Symbol.asyncIterator])
// ---------------------------------------------------------------------------

test("[Symbol.asyncIterator] yields values from remote next events", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	// Set up an anonymous channel on the requestor side
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	const results = []
	const iter = chan[Symbol.asyncIterator]()

	// Deliver two values then done
	const nextPromise1 = iter.next()
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: 10, done: false }] })
	)
	results.push((await nextPromise1).value)

	const nextPromise2 = iter.next()
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: 20, done: false }] })
	)
	results.push((await nextPromise2).value)

	const nextPromise3 = iter.next()
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: undefined, done: true }] })
	)
	const final = await nextPromise3
	assert.equal(final.done, true)

	assert.deepEqual(results, [10, 20])
})

test("[Symbol.asyncIterator] buffers one item when consumer is slow", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	const iter = chan[Symbol.asyncIterator]()
	// Emit before consumer calls next()
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: 42, done: false }] })
	)
	const result = await iter.next()
	assert.equal(result.value, 42)
	assert.equal(result.done, false)
	// Clean up
	await iter.return()
})

test("[Symbol.asyncIterator] buffer overflow errors iterator but leaves channel open", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	const iter = chan[Symbol.asyncIterator]()
	// Fill the buffer
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: 1, done: false }] })
	)
	// Overflow
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: 2, done: false }] })
	)

	// The buffered item is an error now
	await assert.rejects(() => iter.next(), /buffer overflow/)
	// Channel itself is still open
	assert.ok(wrapper._anonymousChannels["1"] !== undefined)
})

test("[Symbol.asyncIterator] return() does not close the channel", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	const iter = chan[Symbol.asyncIterator]()
	await iter.return()
	// Channel remains open after return()
	assert.ok(wrapper._anonymousChannels["1"] !== undefined)
	// Subsequent next() returns done immediately
	const result = await iter.next()
	assert.equal(result.done, true)
})

test("[Symbol.asyncIterator] channel close rejects pending next()", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	const iter = chan[Symbol.asyncIterator]()
	const nextPromise = iter.next()
	// Close the channel externally (e.g. timeout or signal)
	chan.close()
	await assert.rejects(nextPromise, /closed before iteration completed/)
})

test("[Symbol.asyncIterator] emits start event on first next() call", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	const iter = chan[Symbol.asyncIterator]()
	// First next() should emit "start" on the channel
	iter.next()
	const startMsg = lastSent(socket)
	assert.equal(startMsg.h, "1")
	assert.deepEqual(startMsg.a, ["start"])
	// Satisfy the pending consumer so no unresolved promise lingers
	await iter.return()
})

test("[Symbol.asyncIterator] does not emit start on subsequent next() calls", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	const iter = chan[Symbol.asyncIterator]()
	const nextPromise1 = iter.next() // emits "start"
	const sentCountAfterFirst = socket.sent.length
	// Deliver first value to satisfy pending
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: 1, done: false }] })
	)
	await nextPromise1
	iter.next() // should NOT emit "start" again
	assert.equal(socket.sent.length, sentCountAfterFirst) // no new message
	await iter.return()
})

test("[Symbol.asyncIterator] throw() sends cancellation and rejects", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	const iter = chan[Symbol.asyncIterator]()
	const err = new Error("test error")
	await assert.rejects(() => iter.throw(err), /test error/)
	// Channel should be closed
	assert.equal(wrapper._anonymousChannels["1"], undefined)
	// Cancellation message sent to remote via chan.abort() using {h, x} format
	const cancelMsg = lastSent(socket)
	assert.equal(cancelMsg.h, "1")
	assert.ok(cancelMsg.x != null)
})

test("[Symbol.asyncIterator] normal completion does not close the channel", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	const iter = chan[Symbol.asyncIterator]()
	// Start and deliver a done signal
	const nextPromise = iter.next() // emits "start"
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: undefined, done: true }] })
	)
	const final = await nextPromise
	assert.equal(final.done, true)
	// Channel remains open after natural completion
	assert.ok(wrapper._anonymousChannels["1"] !== undefined)
})

test("[Symbol.asyncIterator] concurrent next() returns rejected Promise, not a sync throw", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	const iter = chan[Symbol.asyncIterator]()
	const next1 = iter.next() // pending — no data yet
	// Second call before first resolves: must return a rejected Promise, not throw
	let secondCallResult
	assert.doesNotThrow(() => {
		secondCallResult = iter.next()
	})
	await assert.rejects(secondCallResult, /cannot call next\(\) concurrently/)
	// First promise still works once data arrives
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: 99, done: false }] })
	)
	assert.equal((await next1).value, 99)
	await iter.return()
})

test("[Symbol.asyncIterator] return(value) passes value through", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	const iter = chan[Symbol.asyncIterator]()
	const result = await iter.return(42)
	assert.deepEqual(result, { value: 42, done: true })
})

test("[Symbol.asyncIterator] return() clears buffered terminal item; next() returns done", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	const iter = chan[Symbol.asyncIterator]()
	// Start the iterator and satisfy the first next() call
	const first = iter.next()
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: 1, done: false }] })
	)
	await first

	// Emit the terminal item with no pending consumer — it gets buffered and
	// done is set to true inside the iterator before return() is called
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: "final", done: true }] })
	)

	// return() while the terminal item is buffered and done===true
	const returnResult = await iter.return()
	assert.deepEqual(returnResult, { value: undefined, done: true })

	// next() must NOT return the stale buffered item
	const afterReturn = await iter.next()
	assert.deepEqual(afterReturn, { value: undefined, done: true })
})

test("[Symbol.asyncIterator] throw() on closed iterator clears stale buffer; next() returns done", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	const iter = chan[Symbol.asyncIterator]()
	// Satisfy initial next() so we can buffer a terminal item
	const first = iter.next()
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: 1, done: false }] })
	)
	await first

	// Buffer a terminal item → done becomes true internally
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: "last", done: true }] })
	)

	// throw() on an already-done iterator should reject and clear stale buffer
	const throwErr = new Error("abort")
	await assert.rejects(iter.throw(throwErr), /abort/)

	// next() must NOT return the stale buffered item
	const afterThrow = await iter.next()
	assert.deepEqual(afterThrow, { value: undefined, done: true })
})

test("[Symbol.asyncIterator] can iterate the same channel multiple times", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	// First iteration
	const iter1 = chan[Symbol.asyncIterator]()
	const next1 = iter1.next() // emits "start"
	const startMsg1 = lastSent(socket)
	assert.deepEqual(startMsg1.a, ["start"])
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: 1, done: false }] })
	)
	assert.equal((await next1).value, 1)
	await iter1.return() // end first iteration without closing channel

	// Second iteration — should emit "start" again
	const sentBefore = socket.sent.length
	const iter2 = chan[Symbol.asyncIterator]()
	const next2 = iter2.next() // should emit "start" again
	assert.equal(socket.sent.length, sentBefore + 1)
	const startMsg2 = lastSent(socket)
	assert.deepEqual(startMsg2.a, ["start"])
	wrapper._onMessage(
		JSON.stringify({ h: "1", a: ["next", { value: 2, done: false }] })
	)
	assert.equal((await next2).value, 2)
	await iter2.return()
})

// ---------------------------------------------------------------------------
// Bug fix: abort() on named channels and already-closed anonymous channels
// ---------------------------------------------------------------------------

test("abort() on a named channel is a no-op and does not send a cancel message", () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const ch = wrapper.of("chat")
	const sentBefore = socket.sent.length
	// Calling abort() on a named channel should not send {h, x} to the remote.
	// With the old code (|| instead of &&) this would send a spurious cancel.
	ch.abort()
	assert.equal(
		socket.sent.length,
		sentBefore,
		"no cancel message should be sent for a named channel"
	)
	// The channel should still be closed after abort()
	assert.notEqual(
		wrapper.of("chat"),
		ch,
		"channel should be closed after abort()"
	)
})

test("abort() on an already-closed anonymous channel does not throw", async () => {
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p
	assert.equal(chan.isAnonymous, true)
	chan.close() // first close — sets _wrapper to null
	assert.equal(
		wrapper._anonymousChannels["1"],
		undefined,
		"channel should be gone"
	)
	// With the old code (|| instead of &&) this crashes: null._sendCancelAnon()
	assert.doesNotThrow(
		() => chan.abort(),
		"abort() on an already-closed anonymous channel must not throw"
	)
})

// ---------------------------------------------------------------------------
// Bug fix: close(reason) propagates reason to closeSignal
// ---------------------------------------------------------------------------

test("inbound anonymous channel abort propagates reason to closeSignal", async () => {
	if (typeof AbortController !== "function") return
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const p = wrapper.request("open-stream")
	wrapper._onMessage(JSON.stringify({ i: 1, h: 1 }))
	const chan = await p

	// Simulate the handler-side sending an abort with a specific Error reason
	wrapper._onMessage(
		JSON.stringify({ h: "1", x: { message: "stream ended" }, _: 1 })
	)
	assert.equal(
		wrapper._anonymousChannels["1"],
		undefined,
		"channel should be closed"
	)
	// closeSignal should have been aborted with the reconstructed Error reason
	assert.ok(chan.closeSignal.aborted, "closeSignal should be aborted")
	assert.ok(
		chan.closeSignal.reason instanceof Error,
		"reason should be an Error instance"
	)
	assert.equal(
		chan.closeSignal.reason.message,
		"stream ended",
		"reason message should match"
	)
})

test("channel.close(reason) sets closeSignal.reason", () => {
	if (typeof AbortController !== "function") return
	const socket = makeSocket()
	const wrapper = new WebSocketWrapper(socket, {})
	const ch = wrapper.of("chat")
	const reason = new Error("explicit close reason")
	ch.close(reason)
	assert.ok(ch.closeSignal.aborted, "closeSignal should be aborted")
	assert.equal(ch.closeSignal.reason, reason, "closeSignal.reason should match")
})

// ---------------------------------------------------------------------------
// Integration: multiple events, requests, cancellation, and anonymous channel
// ---------------------------------------------------------------------------

/** Wire two wrappers together so each side's sends arrive as the other's receives. */
function makeConnectedPair() {
	const serverSocket = makeSocket()
	const clientSocket = makeSocket()
	const server = new WebSocketWrapper(serverSocket, {})
	const client = new WebSocketWrapper(clientSocket, {})
	clientSocket.send = (msg) => {
		clientSocket.sent.push(msg)
		server._onMessage(msg)
	}
	serverSocket.send = (msg) => {
		serverSocket.sent.push(msg)
		client._onMessage(msg)
	}
	return { server, client, serverSocket, clientSocket }
}

test("integration: multiple events, requests, cancellation, and anonymous channel", async () => {
	const { server, client } = makeConnectedPair()
	const log = []

	// --- Server-side handlers ---
	server.on("ping", (msg) => {
		log.push("server:ping:" + msg)
	})
	server.on("echo", (msg) => msg)
	server.on("slow", () => new Promise(() => {})) // never resolves
	server.on("open-stream", function () {
		log.push("server:stream-opened")
		return this.channel()
	})

	// 1. Fire-and-forget event
	client.emit("ping", "hello")
	assert.ok(log.includes("server:ping:hello"), "server should receive event")

	// 2. Successful round-trip request
	const echoResult = await client.request("echo", "world")
	assert.equal(echoResult, "world")

	// 3. Request cancelled via AbortSignal (requires AbortController)
	if (typeof AbortController === "function") {
		const ac = new AbortController()
		const slowP = client.signal(ac.signal).request("slow")
		const slowId = client._lastRequestId
		ac.abort("user cancelled")
		await assert.rejects(slowP, (err) => err.name === "RequestAbortedError")
		assert.equal(
			server._activeRequests[slowId],
			undefined,
			"server should clean up active request after cancellation"
		)
		log.push("client:slow-cancelled")
	}

	// 4. Request an anonymous channel and iterate it
	const streamChan = await client.request("open-stream")
	assert.ok(streamChan.isAnonymous, "should receive an anonymous channel")
	assert.ok(
		log.includes("server:stream-opened"),
		"server stream handler should have run"
	)

	// Both sides reference the channel by the same request-ID key
	const serverChan = server._anonymousChannels[String(streamChan._name)]
	assert.ok(serverChan, "server should hold a matching anonymous channel")

	const iter = streamChan[Symbol.asyncIterator]()
	const values = []

	// Pull value 1: iter.next() sets `pending` then we emit synchronously
	const p1 = iter.next() // emits "start" to server; pending set after
	serverChan.emit("next", { value: 1, done: false })
	values.push((await p1).value)

	// Pull value 2
	const p2 = iter.next()
	serverChan.emit("next", { value: 2, done: false })
	values.push((await p2).value)

	// Signal done
	const p3 = iter.next()
	serverChan.emit("next", { value: undefined, done: true })
	const final = await p3
	assert.equal(final.done, true)

	assert.deepEqual(values, [1, 2])
	log.push("client:stream-done")

	// Verify the overall story
	assert.ok(log.includes("server:ping:hello"))
	assert.ok(log.includes("server:stream-opened"))
	assert.ok(log.includes("client:stream-done"))
	// Channel is still open (normal completion does not close it)
	assert.ok(
		server._anonymousChannels[String(streamChan._name)],
		"channel stays open"
	)
})

// ---------------------------------------------------------------------------
// Channel reuse: for-await loop called twice on the same channel
// ---------------------------------------------------------------------------

test("[Symbol.asyncIterator] for-await loop can be used twice on the same channel", async () => {
	if (typeof AbortController !== "function") return // closeSignal needed for reliable done detection
	const { server, client } = makeConnectedPair()

	server.on("open-stream", function () {
		return this.channel()
	})

	const chan = await client.request("open-stream")
	const serverChan = server._anonymousChannels[String(chan._name)]

	// First for-await loop — server emits via microtask-deferred callbacks so
	// that `pending` is set before the values arrive (fake socket is synchronous)
	serverChan.once("start", () => {
		Promise.resolve()
			.then(() => serverChan.emit("next", { value: 10, done: false }))
			.then(() => serverChan.emit("next", { value: undefined, done: true }))
	})

	const values1 = []
	for await (const v of chan) {
		values1.push(v)
	}
	assert.deepEqual(values1, [10])
	assert.ok(
		server._anonymousChannels[String(chan._name)],
		"channel should remain open after first loop"
	)

	// Second for-await loop — should emit "start" again
	serverChan.once("start", () => {
		Promise.resolve()
			.then(() => serverChan.emit("next", { value: 20, done: false }))
			.then(() => serverChan.emit("next", { value: undefined, done: true }))
	})

	const values2 = []
	for await (const v of chan) {
		values2.push(v)
	}
	assert.deepEqual(values2, [20])
	assert.ok(
		server._anonymousChannels[String(chan._name)],
		"channel should remain open after second loop"
	)
})

// ---------------------------------------------------------------------------
// Without AbortController
// ---------------------------------------------------------------------------

test("without AbortController: outbound requests resolve and reject normally", async () => {
	const savedAC = globalThis.AbortController
	globalThis.AbortController = undefined
	try {
		const socket = makeSocket()
		const wrapper = new WebSocketWrapper(socket, {})

		// Outbound request resolves
		const p = wrapper.request("ping")
		const { i: reqId } = JSON.parse(socket.sent[socket.sent.length - 1])
		wrapper._onMessage(JSON.stringify({ i: reqId, d: "pong" }))
		assert.equal(await p, "pong")

		// Outbound request rejects
		const p2 = wrapper.request("fail")
		const { i: reqId2 } = JSON.parse(socket.sent[socket.sent.length - 1])
		wrapper._onMessage(
			JSON.stringify({ i: reqId2, e: { message: "oops" }, _: 1 })
		)
		await assert.rejects(
			p2,
			(err) => err instanceof Error && err.message === "oops"
		)

		// No active requests are tracked (no AbortController to back them)
		assert.equal(wrapper.activeRequestCount, 0)
		// closeSignal is null when AbortController is unavailable
		assert.equal(wrapper.closeSignal, null)
	} finally {
		globalThis.AbortController = savedAC
	}
})

test("without AbortController: inbound requests are handled and return responses", () => {
	const savedAC = globalThis.AbortController
	globalThis.AbortController = undefined
	try {
		const socket = makeSocket()
		const wrapper = new WebSocketWrapper(socket, {})
		wrapper.on("echo", (msg) => msg)

		wrapper._onMessage(JSON.stringify({ a: ["echo", "hi"], i: 42 }))
		const reply = lastSent(socket)
		assert.equal(reply.i, 42)
		assert.equal(reply.d, "hi")
		// No active request entry (no AbortController)
		assert.equal(wrapper.activeRequestCount, 0)
	} finally {
		globalThis.AbortController = savedAC
	}
})

test("without AbortController: inbound cancellation is silently ignored", async () => {
	const savedAC = globalThis.AbortController
	globalThis.AbortController = undefined
	try {
		const socket = makeSocket()
		const wrapper = new WebSocketWrapper(socket, {})

		let resolveHandler
		wrapper.on(
			"slow",
			() => new Promise((resolve) => (resolveHandler = resolve))
		)

		// Start an inbound request
		wrapper._onMessage(JSON.stringify({ a: ["slow"], i: 5 }))

		// Send a cancellation — without AbortController, activeReqs[5] doesn't
		// exist so this message is silently ignored
		const sentBefore = socket.sent.length
		wrapper._onMessage(JSON.stringify({ x: { message: "cancel" }, _: 1, i: 5 }))
		assert.equal(
			socket.sent.length,
			sentBefore,
			"no reply should be sent for the ignored cancellation"
		)

		// The handler is still running; resolve it normally
		resolveHandler("done")
		await Promise.resolve()
		await Promise.resolve()
		const reply = lastSent(socket)
		assert.equal(reply.d, "done", "handler should still send its response")
	} finally {
		globalThis.AbortController = savedAC
	}
})

test("without AbortController: this.channel() is not available in request handlers", () => {
	const savedAC = globalThis.AbortController
	globalThis.AbortController = undefined
	try {
		const socket = makeSocket()
		const wrapper = new WebSocketWrapper(socket, {})

		let channelType = "not-called"
		wrapper.on("test", function () {
			channelType = typeof this.channel
			return "ok"
		})
		wrapper._onMessage(JSON.stringify({ a: ["test"], i: 1 }))
		assert.equal(
			channelType,
			"undefined",
			"this.channel should not be available without AbortController"
		)
	} finally {
		globalThis.AbortController = savedAC
	}
})

test("without AbortController: this.signal is not available in request handlers", () => {
	const savedAC = globalThis.AbortController
	globalThis.AbortController = undefined
	try {
		const socket = makeSocket()
		const wrapper = new WebSocketWrapper(socket, {})

		// Without AbortController the per-request context isn't created, so
		// `this` inside the handler is the plain channel (which has a signal()
		// *method*, not a signal *property*).
		let signalType = "not-called"
		wrapper.on("test", function () {
			// this.signal is the signal() chaining method, not an AbortSignal
			signalType = typeof this.signal
			return "ok"
		})
		wrapper._onMessage(JSON.stringify({ a: ["test"], i: 2 }))
		assert.equal(
			signalType,
			"function",
			"this.signal should be the chaining method, not an AbortSignal"
		)
	} finally {
		globalThis.AbortController = savedAC
	}
})

// ---------------------------------------------------------------------------
// Nested anonymous channel: handler inside an anonymous channel creates another
// ---------------------------------------------------------------------------

test("anonymous channel request handler can create a nested anonymous channel", async () => {
	if (typeof AbortController !== "function") return
	const { server, client } = makeConnectedPair()

	// Server: outer stream handler creates an anonymous channel.
	// That channel exposes a "open-nested" handler that itself creates another
	// anonymous channel.
	server.on("open-stream", function () {
		const outerChan = this.channel()
		outerChan.on("open-nested", function () {
			return this.channel()
		})
		return outerChan
	})

	// 1. Client requests the outer anonymous channel
	const outerChan = await client.request("open-stream")
	assert.ok(outerChan.isAnonymous, "outer channel should be anonymous")

	const serverOuterChan = server._anonymousChannels[String(outerChan._name)]
	assert.ok(serverOuterChan, "server should hold the outer anonymous channel")

	// 2. Client makes a request on the outer channel to open a nested channel
	const nestedChan = await outerChan.request("open-nested")
	assert.ok(nestedChan.isAnonymous, "nested channel should be anonymous")
	assert.notEqual(
		nestedChan._name,
		outerChan._name,
		"nested and outer channels must have different names"
	)

	const serverNestedChan = server._anonymousChannels[String(nestedChan._name)]
	assert.ok(serverNestedChan, "server should hold the nested anonymous channel")

	// 3. Server emits an event on the nested channel; client receives it
	let received = null
	nestedChan.on("data", (val) => {
		received = val
	})
	serverNestedChan.emit("data", "nested-value")
	assert.equal(
		received,
		"nested-value",
		"client should receive events on nested channel"
	)

	// 4. Client can also emit on the nested channel back to the server
	let serverReceived = null
	serverNestedChan.on("ack", (val) => {
		serverReceived = val
	})
	nestedChan.emit("ack", "client-ack")
	assert.equal(
		serverReceived,
		"client-ack",
		"server should receive events on nested channel"
	)

	// 5. Closing the nested channel does not close the outer channel
	nestedChan.close()
	assert.equal(client._anonymousChannels[String(nestedChan._name)], undefined)
	assert.ok(
		client._anonymousChannels[String(outerChan._name)],
		"outer channel should still be open"
	)
})

// ---------------------------------------------------------------------------
// iterableHandler
// ---------------------------------------------------------------------------

test("iterableHandler: sync generator streams all yielded values then done", async () => {
	if (typeof AbortController !== "function") return
	const { server, client } = makeConnectedPair()

	server.on(
		"stream",
		iterableHandler(function* () {
			yield 1
			yield 2
			yield 3
		})
	)

	const chan = await client.request("stream")
	const results = []
	for await (const val of chan) {
		results.push(val)
	}
	chan.close()
	assert.deepEqual(results, [1, 2, 3])
})

test("iterableHandler: async generator streams all yielded values then done", async () => {
	if (typeof AbortController !== "function") return
	const { server, client } = makeConnectedPair()

	server.on(
		"stream",
		iterableHandler(async function* () {
			yield "a"
			yield "b"
		})
	)

	const chan = await client.request("stream")
	const results = []
	for await (const val of chan) {
		results.push(val)
	}
	chan.close()
	assert.deepEqual(results, ["a", "b"])
})

test("iterableHandler: any sync iterable works (plain array)", async () => {
	if (typeof AbortController !== "function") return
	const { server, client } = makeConnectedPair()

	server.on(
		"stream",
		iterableHandler(function () {
			return [10, 20, 30]
		})
	)

	const chan = await client.request("stream")
	const results = []
	for await (const val of chan) {
		results.push(val)
	}
	chan.close()
	assert.deepEqual(results, [10, 20, 30])
})

test("iterableHandler: handler args are forwarded to the generator", async () => {
	if (typeof AbortController !== "function") return
	const { server, client } = makeConnectedPair()

	server.on(
		"stream",
		iterableHandler(function* (start, end) {
			for (let i = start; i <= end; i++) yield i
		})
	)

	const chan = await client.request("stream", 3, 5)
	const results = []
	for await (const val of chan) {
		results.push(val)
	}
	chan.close()
	assert.deepEqual(results, [3, 4, 5])
})

test("iterableHandler: non-iterable return value rejects the request", async () => {
	if (typeof AbortController !== "function") return
	const { server, client } = makeConnectedPair()

	server.on(
		"oops",
		iterableHandler(function () {
			return 42 // not iterable
		})
	)

	await assert.rejects(client.request("oops"), (err) => {
		return err instanceof Error && /iterable/.test(err.message)
	})
})

test("iterableHandler: error thrown inside generator aborts the channel", async () => {
	if (typeof AbortController !== "function") return
	const { server, client } = makeConnectedPair()

	server.on(
		"stream",
		iterableHandler(async function* () {
			yield 1
			throw new Error("generator blew up")
		})
	)

	const chan = await client.request("stream")
	const iter = chan[Symbol.asyncIterator]()
	// First value should arrive fine
	assert.equal((await iter.next()).value, 1)
	// Second next() should reject because the channel was aborted
	await assert.rejects(iter.next(), /closed before iteration completed/)
})

test("iterableHandler: cancellation from requestor stops iteration", async () => {
	if (typeof AbortController !== "function") return
	const { server, client } = makeConnectedPair()

	let yieldCount = 0
	server.on(
		"stream",
		iterableHandler(async function* () {
			while (true) {
				yieldCount++
				yield yieldCount
				// small delay so the cancel has a chance to close the channel
				await new Promise((resolve) => setImmediate(resolve))
			}
		})
	)

	const chan = await client.request("stream")
	const iter = chan[Symbol.asyncIterator]()

	// Consume a couple of values
	assert.equal((await iter.next()).value, 1)
	assert.equal((await iter.next()).value, 2)

	// Abort the channel — iterator rejects on the next call
	chan.abort()
	await assert.rejects(iter.next(), /closed before iteration completed/)

	// Give the server generator a chance to run; it should stop because closeSignal is aborted
	await new Promise((resolve) => setImmediate(resolve))
	await new Promise((resolve) => setImmediate(resolve))
	const yieldCountAfterAbort = yieldCount
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(
		yieldCount,
		yieldCountAfterAbort,
		"server generator should stop after abort"
	)
})

test("iterableHandler: throws TypeError when fn is not a function", () => {
	assert.throws(() => iterableHandler(42), TypeError)
})
