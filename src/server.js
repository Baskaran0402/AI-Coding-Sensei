const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const { analyzeCodeWithGemini, updateFeedback } = require("./gemini");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "..", "public")));

const sessions = new Map();
let currentModel = "gemini-1.5-flash";

// Custom Q-Learning Implementation
class QLearning {
  constructor({
    numStates,
    numActions,
    learningRate = 0.1,
    discountFactor = 0.9,
  }) {
    this.qTable = new Array(numStates)
      .fill(null)
      .map(() => new Array(numActions).fill(0));
    this.numStates = numStates;
    this.numActions = numActions;
    this.learningRate = learningRate;
    this.discountFactor = discountFactor;
    this.epsilon = 0.1; // Exploration rate
  }

  selectAction(state) {
    if (Math.random() < this.epsilon) {
      return Math.floor(Math.random() * this.numActions); // Explore
    }
    const qValues = this.qTable[state];
    return qValues.indexOf(Math.max(...qValues)); // Exploit
  }

  update(state, action, reward, nextState) {
    const currentQ = this.qTable[state][action];
    const maxNextQ = Math.max(...this.qTable[nextState]);
    const newQ =
      currentQ +
      this.learningRate * (reward + this.discountFactor * maxNextQ - currentQ);
    this.qTable[state][action] = newQ;
  }
}

const rl = new QLearning({
  numStates: 1000,
  numActions: 5, // generate, correct, snippet, chat, analyze
});
let lastState = null;
let lastAction = null;

function hashState(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) + hash + input.charCodeAt(i);
  }
  return Math.abs(hash) % 1000;
}

function generateSessionId() {
  return Math.random().toString(36).substr(2, 9);
}

async function summarizeCode(prompt, code) {
  if (prompt.toLowerCase().includes("login page") && code.match(/html|css/i))
    return "Login Page";
  if (prompt.toLowerCase().includes("react website")) return "React Website";
  if (prompt.toLowerCase().includes("fibonacci")) return "Fibonacci Sequence";
  return prompt.length > 20 ? prompt.slice(0, 20) + "..." : prompt;
}

function executeCode(code) {
  try {
    const languageIdentifiers = [
      "javascript",
      "python",
      "java",
      "cpp",
      "c",
      "ruby",
      "go",
      "rust",
      "php",
      "typescript",
    ];
    let detectedLanguage = "javascript"; // Default
    const lines = code.split("\n");
    for (let lang of languageIdentifiers) {
      if (lines[0].toLowerCase().includes(lang)) {
        detectedLanguage = lang;
        break;
      }
    }

    if (detectedLanguage === "javascript") {
      const script = new Function(code);
      let result;
      try {
        result = script();
      } catch (e) {
        result = `Error: ${e.message}`;
      }
      return result !== undefined ? result.toString() : "No output";
    } else if (detectedLanguage === "python") {
      return "Python output not supported directly (requires runtime)";
    } else {
      return "Output not supported for this language";
    }
  } catch (e) {
    return `Execution error: ${e.message}`;
  }
}

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);
      console.log("Received message from client:", data);
      let result;

      const currentState = hashState(
        data.type + (data.text || data.code || "")
      );
      const actions = ["generate", "correct", "snippet", "chat", "analyze"];
      let actionIndex;

      if (lastState !== null && lastAction !== null) {
        const reward =
          data.type === "feedback" ? (data.value === "good" ? 1 : -1) : 0;
        rl.update(lastState, lastAction, reward, currentState);
      }

      actionIndex = rl.selectAction(currentState);
      const chosenAction = actions[actionIndex];

      switch (data.type) {
        case "prompt":
          let mode = "generate";
          if (data.feature === "chat") mode = "chat";
          else if (data.feature === "snippet") mode = "snippet";
          else if (data.feature === "aiHelp") mode = "generate";
          else if (data.feature === "correction") mode = "correct";
          else if (data.feature === "come-and-code") {
            const sessionId = generateSessionId();
            sessions.set(sessionId, {
              code: "// Collaborative coding started\n",
              clients: new Set([ws]),
            });
            ws.sessionId = sessionId;
            ws.send(JSON.stringify({ type: "sessionCreated", sessionId }));
            return;
          }

          result = await analyzeCodeWithGemini(data.text, mode, currentModel);
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
            const output = executeCode(result);
            ws.send(
              JSON.stringify({
                type: "aiCode",
                code: result,
                summaryTitle,
                output,
              })
            );
          }
          break;

        case "codeUpdate":
          result = await analyzeCodeWithGemini(
            data.code,
            chosenAction,
            currentModel
          );
          if (data.requestComment) {
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
          result = await analyzeCodeWithGemini(
            data.code,
            chosenAction,
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
          result = await analyzeCodeWithGemini(
            data.query,
            chosenAction,
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
          updateFeedback(data.query, data.value);
          if (data.value === "good") {
            ws.send(
              JSON.stringify({
                type: "feedbackAck",
                message: "Thanks for your feedback!",
              })
            );
          } else if (data.value === "bad") {
            // Try a better response
            let betterResult;
            const originalMode = chosenAction;
            const fallbackModes = ["snippet", "chat", "correct"].filter(
              (m) => m !== originalMode
            );
            for (let mode of fallbackModes) {
              betterResult = await analyzeCodeWithGemini(
                data.query,
                mode,
                currentModel
              );
              if (!betterResult.startsWith("// Error:")) break;
            }
            if (betterResult && !betterResult.startsWith("// Error:")) {
              const summaryTitle = await summarizeCode(
                "Improved Response",
                betterResult
              );
              ws.send(
                JSON.stringify({
                  type: "betterResponse",
                  code: betterResult,
                  summaryTitle,
                })
              );
            } else {
              ws.send(
                JSON.stringify({
                  type: "feedbackAck",
                  message: "Sorry, unable to improve. Try a different query!",
                })
              );
            }
          }
          break;

        case "snippetRequest":
          result = await analyzeCodeWithGemini(
            "Provide a beginner-friendly reusable code snippet with explanation",
            chosenAction,
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
          result = await analyzeCodeWithGemini(
            `Convert this code to ${data.language}:\n${data.code}`,
            chosenAction,
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
            const output = executeCode(result);
            ws.send(
              JSON.stringify({
                type: "aiCode",
                code: result,
                summaryTitle,
                output,
              })
            );
          }
          break;

        case "timeMachine":
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
          result = await analyzeCodeWithGemini(
            `Rewrite this code in a ${data.style} style:\n${data.code}`,
            chosenAction,
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
            const output = executeCode(result);
            ws.send(
              JSON.stringify({
                type: "aiCode",
                code: result,
                summaryTitle,
                output,
              })
            );
          }
          break;

        case "startCollab":
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
          }
          break;

        case "collabUpdate":
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
          }
          break;

        case "screenCapture":
          result = await analyzeCodeWithGemini(
            data.image || "Generate code based on this screen capture",
            chosenAction,
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
            const output = executeCode(result);
            ws.send(
              JSON.stringify({
                type: "screenCaptureResponse",
                code: result,
                summaryTitle,
                output,
              })
            );
          }
          break;

        case "modelUpdate":
          currentModel = data.model;
          ws.send(
            JSON.stringify({ type: "modelUpdated", model: currentModel })
          );
          break;

        default:
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Unknown message type",
              requestTitle: data.type,
            })
          );
      }

      lastState = currentState;
      lastAction = actionIndex;
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
