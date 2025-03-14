const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const { analyzeCodeWithGemini, updateFeedback } = require("./gemini");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "..", "public")));

// Store collaboration sessions and model preferences
const sessions = new Map();
let currentModel = "gemini-1.5-flash"; // Default model

// Generate a unique session ID
function generateSessionId() {
  return Math.random().toString(36).substr(2, 9);
}

// Function to summarize code for timeline title
async function summarizeCode(prompt, code) {
  if (prompt.toLowerCase().includes("login page") && code.match(/html|css/i)) {
    return "Login Page";
  }
  // Add more conditions for other types of code
  if (prompt.toLowerCase().includes("react website")) {
    return "React Website";
  }
  if (prompt.toLowerCase().includes("fibonacci")) {
    return "Fibonacci Sequence";
  }
  // Fallback: Use a generic title based on prompt
  return prompt.length > 20 ? prompt.slice(0, 20) + "..." : prompt;
}

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);
      console.log("Received message from client:", data);
      let result;

      switch (data.type) {
        case "prompt":
          console.log("Processing prompt with model:", currentModel);
          result = await analyzeCodeWithGemini(
            data.text,
            "generate",
            currentModel
          );
          if (result.startsWith("// Error:")) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: result,
                requestTitle: data.requestTitle,
              })
            );
          } else {
            const summaryTitle = await summarizeCode(
              data.requestTitle || data.text,
              result
            );
            ws.send(
              JSON.stringify({ type: "aiCode", code: result, summaryTitle })
            );
          }
          break;

        case "codeUpdate":
          console.log("Processing codeUpdate with model:", currentModel);
          if (data.requestComment) {
            result = await analyzeCodeWithGemini(
              data.code,
              "autoCorrect",
              currentModel
            );
            if (result.startsWith("// Error:")) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: result,
                  requestTitle: data.requestTitle,
                })
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: "suggestion",
                  code: result,
                  requestTitle: data.requestTitle,
                })
              );
            }
          }
          const languageOptions = await analyzeCodeWithGemini(
            data.code,
            "languageOptions",
            currentModel
          );
          ws.send(
            JSON.stringify({
              type: "languageOptions",
              options: languageOptions,
            })
          );
          break;

        case "aiHelp":
          console.log("Processing aiHelp with model:", currentModel);
          result = await analyzeCodeWithGemini(
            data.code,
            "fix_or_extend",
            currentModel
          );
          if (result.startsWith("// Error:")) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: result,
                requestTitle: data.requestTitle,
              })
            );
          } else {
            const summaryTitle = await summarizeCode(
              data.requestTitle || "AI Help",
              result
            );
            ws.send(
              JSON.stringify({ type: "aiCode", code: result, summaryTitle })
            );
          }
          break;

        case "chatQuery":
          console.log("Processing chatQuery with model:", currentModel);
          result = await analyzeCodeWithGemini(
            data.query,
            "chat",
            currentModel
          );
          if (result.startsWith("// Error:")) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: result,
                requestTitle: data.query,
              })
            );
          } else {
            ws.send(JSON.stringify({ type: "chatResponse", message: result }));
          }
          break;

        case "feedback":
          console.log("Processing feedback");
          updateFeedback(data.query, data.value);
          ws.send(
            JSON.stringify({
              type: "feedbackAck",
              message: "Thanks for your feedback!",
            })
          );
          break;

        case "snippetRequest":
          console.log("Processing snippetRequest with model:", currentModel);
          result = await analyzeCodeWithGemini(
            "Provide a beginner-friendly reusable code snippet with explanation",
            "generate",
            currentModel
          );
          if (result.startsWith("// Error:")) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: result,
                requestTitle: "Snippet Request",
              })
            );
          } else {
            const [code, explanation] = result.split("\n\n// Explanation:");
            ws.send(
              JSON.stringify({
                type: "snippet",
                code: code.trim(),
                explanation: explanation
                  ? explanation.trim()
                  : "A useful snippet for beginners!",
              })
            );
          }
          break;

        case "changeLanguage":
          console.log("Processing changeLanguage with model:", currentModel);
          result = await analyzeCodeWithGemini(
            `Convert this code to ${data.language}:\n${data.code}`,
            "generate",
            currentModel
          );
          if (result.startsWith("// Error:")) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: result,
                requestTitle: data.requestTitle,
              })
            );
          } else {
            const summaryTitle = await summarizeCode(data.requestTitle, result);
            ws.send(
              JSON.stringify({ type: "aiCode", code: result, summaryTitle })
            );
          }
          break;

        case "timeMachine":
          console.log("Processing timeMachine");
          const latestCode = data.history.length
            ? data.history[data.history.length - 1].code
            : "// No previous code";
          ws.send(
            JSON.stringify({
              type: "aiCode",
              code: latestCode,
              summaryTitle: "Time Machine Restore",
            })
          );
          break;

        case "duetCode":
          console.log("Processing duetCode with model:", currentModel);
          result = await analyzeCodeWithGemini(
            `Rewrite this code in a ${data.style} style:\n${data.code}`,
            "generate",
            currentModel
          );
          if (result.startsWith("// Error:")) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: result,
                requestTitle: data.requestTitle,
              })
            );
          } else {
            const summaryTitle = await summarizeCode(data.requestTitle, result);
            ws.send(
              JSON.stringify({ type: "aiCode", code: result, summaryTitle })
            );
          }
          break;

        case "startCollab":
          console.log("Processing startCollab");
          const sessionId = generateSessionId();
          sessions.set(sessionId, {
            code: data.code || "// Collaborative coding started\n",
            clients: new Set([ws]),
          });
          ws.sessionId = sessionId;
          ws.send(JSON.stringify({ type: "sessionCreated", sessionId }));
          console.log("Session created:", sessionId);
          break;

        case "joinCollab":
          console.log("Processing joinCollab with sessionId:", data.sessionId);
          const session = sessions.get(data.sessionId);
          if (session) {
            session.clients.add(ws);
            ws.sessionId = data.sessionId;
            ws.send(
              JSON.stringify({
                type: "sessionJoined",
                sessionId: data.sessionId,
                code: session.code,
              })
            );
            console.log("Client joined session:", data.sessionId);
          } else {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Invalid session ID",
                requestTitle: "Join Collab",
              })
            );
            console.log("Join failed: Invalid session ID", data.sessionId);
          }
          break;

        case "collabUpdate":
          console.log("Processing collabUpdate");
          const collabSession = sessions.get(data.sessionId);
          if (collabSession) {
            collabSession.code = data.code;
            collabSession.clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(
                  JSON.stringify({
                    type: "collabUpdate",
                    sessionId: data.sessionId,
                    code: data.code,
                    fromSelf: false,
                  })
                );
                console.log("Broadcast collab update to client");
              }
            });
          } else {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Session not found",
                requestTitle: "Collab Update",
              })
            );
            console.log(
              "Collab update failed: No session found for ID",
              data.sessionId
            );
          }
          break;

        case "screenCapture":
          console.log("Processing screenCapture with model:", currentModel);
          result = await analyzeCodeWithGemini(
            data.image || "Generate code based on this screen capture",
            "screenCapture",
            currentModel
          );
          if (result.startsWith("// Error:")) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: result,
                requestTitle: "Screen Capture",
              })
            );
          } else {
            const summaryTitle = await summarizeCode("Screen Capture", result);
            ws.send(
              JSON.stringify({
                type: "screenCaptureResponse",
                code: result,
                summaryTitle,
              })
            );
          }
          break;

        case "modelUpdate":
          console.log("Processing modelUpdate");
          currentModel = data.model;
          ws.send(
            JSON.stringify({ type: "modelUpdated", model: currentModel })
          );
          break;

        default:
          console.log("Unknown message type:", data.type);
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Unknown message type",
              requestTitle: data.type,
            })
          );
      }
    } catch (error) {
      console.error("WebSocket message error:", error.message);
      ws.send(
        JSON.stringify({
          type: "error",
          message: `// Server error: ${error.message}`,
          requestTitle: data?.requestTitle || "Unknown",
        })
      );
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    if (ws.sessionId) {
      const session = sessions.get(ws.sessionId);
      if (session) {
        session.clients.delete(ws);
        if (session.clients.size === 0) {
          sessions.delete(ws.sessionId);
          console.log(`Session ${ws.sessionId} closed due to no clients`);
        }
      }
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error.message);
  });
});

server.on("error", (error) => {
  console.error("Server error:", error.message);
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
