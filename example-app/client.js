import WebSocketWrapper from "../lib/wrapper.mjs"

// Create WebSocketWrapper
const socket = new WebSocketWrapper(new WebSocket("ws://" + location.host))
socket.on("disconnect", function (wasOpen) {
	// Check `wasOpen` flag, so we don't try to logout on each disconnection
	if (wasOpen) {
		logout()
	}
	// Auto-reconnect
	console.log("Reconnecting in 5 secs...")
	setTimeout(() => {
		socket.bind(new WebSocket("ws://" + location.host))
	}, 5000)
})
socket.on("error", () => {
	socket.disconnect()
})
socket.of("chat").on("message", addMessage)

// AbortController for slow request demo
let slowRequestAbortController = null

function addMessage(fromStr, msg) {
	// Add a message to the DOM
	const p = $('<p class="message">')
	const from = $('<span class="from">')
	if (fromStr === "system") {
		from.addClass("system")
	} else if (fromStr === $("#username").val()) {
		from.addClass("me")
	}
	from.append(fromStr + ":")
	p.append(from)
	p.append(" " + msg)
	const list = $("#messageList").append(p).get(0)
	// Now scroll down automatically
	if (list.scrollHeight - list.scrollTop - list.clientHeight <= 30) {
		list.scrollTop = list.scrollHeight
	}
}

function login() {
	$("#loginButton").hide()
	$("#username").attr("disabled", "disabled")
	// Send request to login
	socket
		.of("chat")
		.request("login", $("#username").val())
		.then(() => {
			// Login succeeded
			$("#logoutButton, #newMessage").show()
			addMessage("system", "You have been logged in")
			$("#message").val("").focus()
		})
		.catch((err) => {
			// Login failed; just logout...
			// eslint-disable-next-line no-alert
			alert(err)
			logout()
		})
}

function logout() {
	$("#logoutButton, #newMessage").hide()
	$("#loginButton").show()
	$("#username").removeAttr("disabled")
	// Send request to logout
	socket
		.of("chat")
		.request("logout")
		.then(() => {
			addMessage("system", "You have been logged out")
		})
		.catch((err) => {
			console.error(err)
		})
}

function startSlowRequest() {
	$("#slowRequestButton").hide()
	$("#cancelSlowButton").show()
	addMessage("system", "Starting slow request (10 seconds)...")

	slowRequestAbortController = new AbortController()

	socket
		.signal(slowRequestAbortController.signal)
		.request("slowOperation", "demo-data")
		.then((result) => {
			addMessage("system", `Slow request completed: ${result}`)
			$("#slowRequestButton").show()
			$("#cancelSlowButton").hide()
			slowRequestAbortController = null
		})
		.catch((err) => {
			if (err.name === "RequestAbortedError") {
				addMessage("system", "Slow request was cancelled")
			} else {
				addMessage("system", `Slow request failed: ${err.message}`)
			}
			$("#slowRequestButton").show()
			$("#cancelSlowButton").hide()
			slowRequestAbortController = null
		})
}

function cancelSlowRequest() {
	if (slowRequestAbortController) {
		addMessage("system", "Cancelling slow request...")
		slowRequestAbortController.abort()
	}
}

function testTimeout() {
	addMessage("system", "Testing 2-second timeout on 5-second operation...")

	socket
		.timeout(2000) // 2 second timeout
		.request("slowOperation", "timeout-test")
		.then((result) => {
			addMessage("system", `Timeout test completed: ${result}`)
		})
		.catch((err) => {
			addMessage("system", `Timeout test failed as expected: ${err.message}`)
		})
}

$(() => {
	$("#loginButton").on("click", login)
	$("#logoutButton").on("click", logout)
	$("#slowRequestButton").on("click", startSlowRequest)
	$("#cancelSlowButton").on("click", cancelSlowRequest)
	$("#timeoutTestButton").on("click", testTimeout)
	$("#newMessage").on("submit", function sendMessage(e) {
		socket.of("chat").emit("message", $("#message").val())
		$("#message").val("").focus()
		e.preventDefault()
	})

	addMessage("system", "Welcome! Please pick a username and login.")
})
