/* This chat server uses "ws" for Node.js WebSockets and the "koa" web
	framework. "node-module-concat" is used to bundle the client-side code at
	run-time.

	This example does *NOT* use ws-server-wrapper.  For an example using
	ws-server-wrapper, visit the ws-server-wrapper Github repo.
*/
import Koa from "koa"
import serve from "koa-static"
import http from "node:http"
import { WebSocketServer } from "ws"
import WebSocketWrapper from "../lib/wrapper.mjs"

// Create new HTTP server using koa and a new WebSocketServer
const app = new Koa(),
	server = http.createServer(app.callback()),
	socketServer = new WebSocketServer({ server })

// Save all connected `sockets`
const sockets = []
// Save all logged in `users`; keys are usernames, values are the sockets
const users = {}
// Listen for a socket to connect
socketServer.on("connection", function (socket) {
	// Upon connection, wrap the socket and save it in the `sockets` array
	socket = new WebSocketWrapper(socket)
	sockets.push(socket)
	// Setup event handlers on the socket
	socket.of("chat").on("login", (username) => {
		if (
			username === "system" ||
			(users[username] && users[username] !== socket)
		) {
			// Error is sent back to the client
			throw new Error(`Username '${username}' is taken!`)
		} else {
			// Notify all other users
			for (const i in users) {
				users[i]
					.of("chat")
					.emit("message", "system", username + " has logged in")
			}
			// Save the username
			socket.set("username", username)
			users[username] = socket
		}
	})
	socket.of("chat").on("message", (msg) => {
		const username = socket.get("username")
		if (username) {
			// We're logged in, so relay the message to all clients
			for (const i in users) {
				users[i].of("chat").emit("message", username, msg)
			}
		} else {
			throw new Error("Please log in first!")
		}
	})
	socket.of("chat").on("logout", () => {
		const username = socket.get("username")
		if (users[username]) {
			delete users[username]
			// Notify all other users
			for (const i in users) {
				users[i]
					.of("chat")
					.emit("message", "system", username + " has logged out")
			}
		}
	})

	// Handle slow operation that can be cancelled
	socket.on("slowOperation", async function (data) {
		const { signal } = this
		console.log(
			`Starting slow operation for ${socket.get("username")}: ${data}`
		)

		// Check if already cancelled
		if (signal && signal.aborted) {
			throw new Error("Operation was cancelled")
		}

		// Simulate long-running operation with periodic cancellation checks
		for (let i = 0; i < 10; i++) {
			// Check for cancellation
			if (signal && signal.aborted) {
				console.log(`Slow operation cancelled at step ${i + 1}/10`)
				throw new Error("Operation was cancelled")
			}

			// Simulate work (1 second each step = 10 seconds total)
			await new Promise((resolve) => {
				const timeout = setTimeout(resolve, 1000)

				// If cancelled during sleep, clean up timeout
				if (signal) {
					signal.addEventListener("abort", () => {
						clearTimeout(timeout)
						resolve()
					})
				}
			})
		}

		console.log(`Slow operation completed for ${socket.get("username")}`)
		return `Slow operation completed with data: ${data}`
	})

	// Upon disconnect, free resources
	socket.on("disconnect", () => {
		const idx = sockets.indexOf(socket)
		if (idx >= 0) {
			sockets.splice(idx, 1)
		}
		const username = socket.get("username")
		if (users[username]) {
			delete users[username]
			// Notify all other users
			for (const i in users) {
				users[i]
					.of("chat")
					.emit("message", "system", username + " has logged out")
			}
		}
	})
})

// Setup static file server
app.use(serve("dist"))

// Start the server after building client_build.js
const { PORT = 3000 } = process.env
server.listen(PORT, () => {
	console.log("Listening on port " + PORT)
})
