const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: {
    origin: "*",
  },
});
const mysql = require("mysql2");
const formidable = require("formidable");

// Define the connection pool
const db_config = {
  host: "localhost",
  user: "root",
  password: "vroot@4",
  database: "videodb",
  port: 3306,
};

const port = 8080;

http.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});

// Create a connection pool
const connection_pool = mysql.createPool(db_config).promise();

// Dictionary to store connected users
const connected_users = {};

app.get("/healthCheck", (req, res) => {
  res.send("health check passed");
});

// Handle socket connection
io.on("connect", (socket) => {
  const queryParams = socket.handshake.query;
  let email = queryParams.email;

  if (email) {
    email = email.toLowerCase(); // Convert email to lowercase
    const websocketObject = socket.id;
    if (email in connected_users) {
      // User with the same email is already connected, update websocket object
      connected_users[email] = websocketObject;
      console.log("User already connected, updating websocket object");
    } else {
      // New connection, add user to connected_users
      connected_users[email] = websocketObject;
      console.log("Client connected with email:", email);
    }
    console.log("Connected users:", connected_users);
  } else {
    // console.log('Connect else', socket.id);
    socket.emit("message", "Welcome from Node.js server!");
  }

  // Handle socket disconnection
  socket.on("disconnect", () => {
    const websocketObject = socket.id;
    for (const connectedEmail in connected_users) {
      if (connected_users[connectedEmail] === websocketObject) {
        delete connected_users[connectedEmail];
        console.log(`User with email ${connectedEmail} disconnected`);
        console.log("Connected users:", connected_users);
        break;
      }
    }
  });

  // Handle the 'call_initiation' event
  socket.on("call_initiation", async (message) => {
    const { callersId, recipientId, offer } = message;
    console.log("in call initiation");
    console.log("recipeintid :", recipientId);
    try {
      const connection = await connection_pool.getConnection();
      const [user] = await connection.query(
        "SELECT email FROM user WHERE id = ?",
        [recipientId]
      );
      connection.release();
      // Save the email to a variable
      const recipientEmail = user[0].email;
      console.log("recipientEmail Email:", recipientEmail);

      // Find the recipient socket based on recipientId
      const recipientSocket = await findSocketByUserId(recipientId);

      if (recipientSocket) {
        console.log("incomin_call send ");
        // Emit the 'incoming_call' event to the recipient
        recipientSocket.emit("incoming_call", { offer, callersId, recipientEmail });
      } else {
        console.log("Recipient not found");
        // Handle the case where the recipient is not online
      }
    } catch (error) {
      console.error("Error:", error);
    }
  });

  socket.on("answer_sent", async (data) => {
    console.log("in answer_sent");
    // The server receives the answer_sent event from the recipient, containing the SDP
    // answer and the recipient's email.
    let { answer, callersId } = data;

    const callerSocket = await findSocketByUserId(callersId);
    console.log("got caller sokcetId: ");
    if (callerSocket) {
      callerSocket.emit("answer_response", { answer });
      console.log("Answer sent to the caller");
    } else {
      console.log("Caller not found");
    }
  });

  // Event handler for ICE candidates from the client
  socket.on("ice_candidate", (data) => {
    const { candidate, email, target } = data;
    // Convert target to lowercase
    const targetLowerCase = target.toLowerCase();
    // Find the target socket ID using the recipient's email or ID
    const targetSocketId = connected_users[targetLowerCase];
    if (targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        // Forward the ICE candidate to the target peer
        targetSocket.emit("ice_candidate", { candidate });
      } else {
        console.log(`Target socket not found for email/ID: ${targetLowerCase}`);
      }
    } else {
      console.log(`No connected user found for email/ID: ${targetLowerCase}`);
    }
  });

  // Event handler for user login
  socket.on("addToOnline", (email) => {
    const normalizedEmail = email.toLowerCase(); // Convert email to lowercase
    const websocketObject = socket.id;
    if (normalizedEmail in connected_users) {
      // User is already online, update their websocket object
      connected_users[normalizedEmail] = websocketObject;
      console.log("User already connected, updating websocket object");
    } else {
      // User is not yet online, add them to the dictionary
      connected_users[normalizedEmail] = websocketObject;
      console.log("User connected");
    }
    console.log("Connected users:", connected_users);
  });

  socket.on("message", (data) => {
    console.log("Received message:", data);
    io.emit("message", data); // Broadcast to all connected clients
  });
});
// Helper function to find the socket based on userId
const findSocketByUserId = async (userId) => {
  try {
    const connection = await connection_pool.getConnection();
    const [user] = await connection.query(
      "SELECT email FROM user WHERE id = ?",
      [userId]
    );
    connection.release();

    if (user.length > 0) {
      const email = user[0].email;
      const websocketId = connected_users[email];
      if (websocketId) {
        return io.sockets.sockets.get(websocketId) || null;
      } else {
        console.log("User not found in connected_users:", email);
        return null;
      }
    } else {
      return null;
    }
  } catch (error) {
    console.error("Error finding socket by userId:", error);
    return null;
  }
};

app.post("/login", async (req, res) => {
  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields) => {
    if (err) {
      console.error("Error parsing form data:", err);
      return res.status(500).json({ message: "Error parsing form data" });
    }

    const email = fields.email[0]; // Access email as fields.email[0]
    const password = fields.password[0]; // Access password as fields.password[0]

    try {
      const connection = await connection_pool.getConnection();
      const [user] = await connection.query(
        "SELECT * FROM user WHERE email = ? AND BINARY password = ?",
        [email, password]
      );
      connection.release();

      if (user.length > 0) {
        return res.status(200).json({ message: "Logged in successfully!" });
      } else {
        return res
          .status(401)
          .json({ message: "Please enter correct email / password!" });
      }
    } catch (error) {
      console.error("Error processing login request:", error);
      return res
        .status(500)
        .json({ message: "An error occurred while processing your request." });
    }
  });
});

app.post("/register", async (req, res) => {
  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields) => {
    if (err) {
      console.error("Error parsing form data:", err);
      return res.status(500).json({ message: "Error parsing form data" });
    }

    const name = fields.name;
    const password = fields.password;
    const email = fields.email;

    if (!name || !password || !email) {
      return res.status(400).json({ message: "Please fill out the form!" });
    }

    const normalizedEmail = email[0].toLowerCase();

    if (normalizedEmail.includes(" ")) {
      return res
        .status(400)
        .json({ message: "Email should not contain spaces!" });
    }

    const emailRegex = /^[^@]+@[^@]+\.[^@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email address!" });
    }

    try {
      const connection = await connection_pool.getConnection();
      const [account] = await connection.query(
        "SELECT * FROM user WHERE LOWER(email) = ?",
        [normalizedEmail]
      );

      if (account.length > 0) {
        connection.release();
        return res.status(400).json({ message: "Account already exists!" });
      }

      await connection.query(
        "INSERT INTO user VALUES (NULL, ?, ?, ?, NULL, NULL, NULL, NULL)",
        [normalizedEmail, name, password]
      );
      connection.release();
      return res
        .status(200)
        .json({ message: "You have successfully registered!" });
    } catch (error) {
      console.error("Error processing registration request:", error);
      return res.status(500).json({
        message: "An error occurred while processing your request.",
        error: error.message,
      });
    }
  });
});

app.post("/getUserId", async (req, res) => {
  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields) => {
    if (err) {
      console.error("Error parsing form data:", err);
      return res.status(500).json({ message: "Error parsing form data" });
    }

    const email = fields.email[0]; // Access email as fields.email[0]

    try {
      const connection = await connection_pool.getConnection();
      const [user] = await connection.query(
        "SELECT id FROM user WHERE email = ?",
        [email]
      );
      connection.release();

      if (user.length > 0) {
        return res.status(200).json({ user_id: user[0].id });
      } else {
        return res.status(404).json({ message: "User not found" });
      }
    } catch (error) {
      console.error("Error processing getUserId request:", error);
      return res
        .status(500)
        .json({ message: "An error occurred while processing your request." });
    }
  });
});

app.post("/getOnlineUsers", async (req, res) => {
  const form = new formidable.IncomingForm();

  form.parse(req, async (err, fields) => {
    if (err) {
      console.error("Error parsing form data:", err);
      return res.status(500).json({ message: "Error parsing form data" });
    }
    const receivedEmail = fields.email[0]; // Access email as fields.email[0]
    const onlineUsers = [];
    try {
      const connection = await connection_pool.getConnection();

      for (const email in connected_users) {
        // getting email from connected_users dictionary
        const [userDetails] = await connection.query(
          "SELECT id, name, email FROM user WHERE email = ? AND role = 'performer'",
          [email]
        );

        if (userDetails.length > 0) {
          const userDict = {
            id: userDetails[0].id,
            name: userDetails[0].name,
            email: userDetails[0].email,
          };

          // Filter out the user with the received email
          if (userDict.email !== receivedEmail) {
            onlineUsers.push(userDict);
          }
        }
      }
      connection.release();
      if (onlineUsers.length > 0) {
        return res.status(200).json({ online_users: onlineUsers });
      } else {
        return res.status(404).json({ message: "No online performers found" });
      }
    } catch (error) {
      console.error("Error processing getOnlineUsers request:", error);
      return res
        .status(500)
        .json({ message: "An error occurred while processing your request." });
    }
  });
});
