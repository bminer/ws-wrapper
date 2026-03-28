import { strict as assert } from "assert"
import test from "node:test"
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
	await assert.rejects(p, (err) => err instanceof Error)
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
	// A cancellation frame {i, x:1} should have been sent
	const cancel = socket.sent.map(JSON.parse).find((m) => m.x)
	assert.ok(cancel, "cancellation message should be sent")
	assert.equal(cancel.i, reqId)
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
		wrapper._onMessage(JSON.stringify({ x: 1, i: 7 }))
		assert.equal(
			wrapper._activeRequests[7],
			undefined,
			"active request should be cleaned up after cancellation"
		)
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
