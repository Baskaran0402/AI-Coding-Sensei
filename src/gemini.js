const axios = require("axios");
require("dotenv").config();

/** @type {string} API key for Gemini */
const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || "AIzaSyBGCdHuLaR93yMxDhaLd-FhhyqzYftJaCE";

/** @type {string} Base Gemini API endpoint */
const GEMINI_API_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

/** @type {{ [query: string]: string }} */
let feedbackStore = {};

/**
 * Analyzes input using the Gemini API based on the specified mode and model.
 * @param {string} input - The input to process (code, query, or image data).
 * @param {string} mode - The processing mode (e.g., 'generate', 'chat', 'screenCapture').
 * @param {string} model - The Gemini model to use (e.g., 'gemini-1.5-flash', 'gemini-1.5-pro').
 * @returns {Promise<string | object>} The processed result (code, text, or JSON).
 */
async function analyzeCodeWithGemini(
  input,
  mode = "generate",
  model = "gemini-1.5-flash"
) {
  if (!input || typeof input !== "string") {
    return "// Error: Invalid input provided.";
  }

  const GEMINI_API_URL = `${GEMINI_API_BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;

  let prompt = "";
  switch (mode) {
    case "generate":
      prompt = `
You are an expert coding assistant. Given this prompt:
"${input}"
Generate complete, well-structured code with comments suitable for beginners.
If converting to another language (e.g., C, C++, Java, JavaScript, Python), ensure syntax and semantics match the target language accurately.
Return only the code inside triple backticks like this:
\`\`\`
[your code here]
\`\`\`
      `.trim();
      break;

    case "comment":
      prompt = `
You are an expert coding assistant. Given this code:
\`\`\`
${input}
\`\`\`
Add detailed inline comments explaining each significant part for beginners.
Return only the commented code inside triple backticks:
\`\`\`
[your commented code here]
\`\`\`
      `.trim();
      break;

    case "fix_or_extend":
      prompt = `
You are an expert coding assistant. Given this code:
\`\`\`
${input}
\`\`\`
Fix errors or extend logically, adding comments for beginners.
Return only the modified code inside triple backticks:
\`\`\`
[your modified code here]
\`\`\`
      `.trim();
      break;

    case "chat":
      prompt = `
You are an intelligent coding chatbot. Answer this query:
"${input}"
Provide a detailed, step-by-step solution or explanation suitable for beginners, pulling from coding forums, documentation, and best practices.
If applicable, include code inside triple backticks like this: \`\`\`[code here]\`\`\`.
Adjust based on past feedback: ${JSON.stringify(
        feedbackStore[input] || "No feedback yet"
      )}.
      `.trim();
      break;

    case "languageOptions":
      prompt = `
You are an AI coding assistant. Given this code:
\`\`\`
${input}
\`\`\`
Return a JSON object listing all programming languages the code can be converted to.
Include at least: C, C++, Java, JavaScript, Python, Ruby, Go, Rust, PHP, TypeScript.
Return the JSON inside triple backticks like this:
\`\`\`
{"languages": ["C", "C++", "Java", "JavaScript", "Python", "Ruby", "Go", "Rust", "PHP", "TypeScript"]}
\`\`\`
      `.trim();
      break;

    case "autoCorrect":
      prompt = `
You are an expert coding assistant. Given this code:
\`\`\`
${input}
\`\`\`
Auto-correct syntax errors, improve readability, enforce clean code practices (e.g., proper naming, spacing), and add comments for beginners.
Return only the corrected code inside triple backticks like this:
\`\`\`
[corrected code here]
\`\`\`
      `.trim();
      break;

    case "screenCapture":
      prompt = `
You are an expert coding assistant. Given this description or context:
"${input}"
Generate code that might correspond to a screen capture based on the provided text, suitable for beginners with comments.
If no specific details are provided, return a generic example with comments.
Return only the code inside triple backticks like this:
\`\`\`
[your code here]
\`\`\`
      `.trim();
      break;

    default:
      return "// Error: Unknown mode specified.";
  }

  try {
    const requestPayload = { contents: [{ parts: [{ text: prompt }] }] };
    console.log(
      "Sending request to Gemini API with model:",
      model,
      "Payload:",
      JSON.stringify(requestPayload, null, 2)
    );

    const response = await axios.post(GEMINI_API_URL, requestPayload, {
      headers: { "Content-Type": "application/json" },
    });

    console.log(
      "Raw Gemini API response:",
      JSON.stringify(response.data, null, 2)
    );

    if (!response.data || typeof response.data !== "object") {
      if (mode === "languageOptions") {
        return {
          languages: [
            "C",
            "C++",
            "Java",
            "JavaScript",
            "Python",
            "Ruby",
            "Go",
            "Rust",
            "PHP",
            "TypeScript",
          ],
        };
      }
      return "// Error: Invalid API response format.";
    }

    const candidates = response.data.candidates;
    if (
      !Array.isArray(candidates) ||
      candidates.length === 0 ||
      !candidates[0].content ||
      !candidates[0].content.parts ||
      !candidates[0].content.parts[0]
    ) {
      console.error(
        "Invalid candidates structure:",
        JSON.stringify(candidates, null, 2)
      );
      if (mode === "languageOptions") {
        return {
          languages: [
            "C",
            "C++",
            "Java",
            "JavaScript",
            "Python",
            "Ruby",
            "Go",
            "Rust",
            "PHP",
            "TypeScript",
          ],
        };
      }
      return "// Error: No valid candidates in API response.";
    }

    const text = candidates[0].content.parts[0].text;
    if (mode === "languageOptions") {
      const match = text.match(/```[\s\S]*?```/);
      if (match) {
        try {
          return JSON.parse(match[0].replace(/```/g, "").trim());
        } catch (e) {
          console.error("JSON parse error:", e.message, "Raw text:", text);
          return {
            languages: [
              "C",
              "C++",
              "Java",
              "JavaScript",
              "Python",
              "Ruby",
              "Go",
              "Rust",
              "PHP",
              "TypeScript",
            ],
          };
        }
      }
      return {
        languages: [
          "C",
          "C++",
          "Java",
          "JavaScript",
          "Python",
          "Ruby",
          "Go",
          "Rust",
          "PHP",
          "TypeScript",
        ],
      };
    }

    // Extract code from triple backticks and remove the language identifier if present
    const codeMatch = text.match(/```[\s\S]*?```/) || [];
    if (codeMatch.length) {
      let code = codeMatch[0].replace(/```/g, "").trim();
      // Split into lines and remove the first line if it’s a language identifier
      const lines = code.split("\n");
      const languageIdentifiers = [
        "html",
        "javascript",
        "css",
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
      if (
        lines.length > 1 &&
        languageIdentifiers.includes(lines[0].trim().toLowerCase())
      ) {
        code = lines.slice(1).join("\n").trim();
      }
      return code;
    }
    return text.trim();
  } catch (error) {
    console.error("Gemini API error with model:", model, {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      config: error.config,
    });
    if (mode === "languageOptions") {
      return {
        languages: [
          "C",
          "C++",
          "Java",
          "JavaScript",
          "Python",
          "Ruby",
          "Go",
          "Rust",
          "PHP",
          "TypeScript",
        ],
      };
    }
    return `// Error: ${error.message || "Failed to process request."}`;
  }
}

/**
 * Stores feedback for a given query.
 * @param {string} query - The query or input to associate feedback with.
 * @param {string} value - The feedback value (e.g., rating, comment).
 */
function updateFeedback(query, value) {
  if (query && value) {
    feedbackStore[query] = value;
    console.log(`Feedback updated: ${query} -> ${value}`);
  } else {
    console.warn("Invalid feedback input:", { query, value });
  }
}

module.exports = { analyzeCodeWithGemini, updateFeedback };
