import WebSocketWrapper from "../lib/wrapper"

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

$(() => {
	$("#loginButton").on("click", login)
	$("#logoutButton").on("click", logout)
	$("#newMessage").on("submit", function sendMessage(e) {
		socket.of("chat").emit("message", $("#message").val())
		$("#message").val("").focus()
		e.preventDefault()
	})

	addMessage("system", "Welcome! Please pick a username and login.")
})
