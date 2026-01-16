const express = require("express");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const fetch = require("node-fetch"); 
const cors = require("cors");    
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function sendToDiscord(content) {
  if (!DISCORD_WEBHOOK_URL) return;
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
  } catch (err) {
    console.error("Discord webhook error:", err);
  }
}

const TEXT_FILE = path.join(__dirname, "dataset.txt");
const CONTEXT_LINES = 3;

const STOPWORDS = new Set([
  "the","is","are","was","were","what","which","who","whom",
  "a","an","of","to","in","on","for","with","and","or",
  "does","do","did","how","why","when","explain","define",
  "tell","about","write","should","think","where", "on", "above", "why", "here", "explain", "mean", "meaning", 
  "know", "known", "can", "cannot", "could", "couldn't"
]);

const lines = fs.readFileSync(TEXT_FILE, "utf-8")
  .split("\n")
  .map(line => line.trim())
  .filter(line => line.length > 0);

console.log(`✅ Loaded ${lines.length} textbook lines`);

function extractKeywords(question) {
  const words = question.toLowerCase().match(/[a-zA-Z]{3,}/g) || [];
  const keywords = words.filter(w => !STOPWORDS.has(w));
  keywords.sort((a, b) => b.length - a.length);
  return keywords;
}

function retrieveParagraphs(question) {
  const keywords = extractKeywords(question);
  const matchedIndices = new Set();

  lines.forEach((line, i) => {
    const lineLower = line.toLowerCase();
    keywords.forEach(word => {
      if (lineLower.includes(word)) {
        const start = Math.max(0, i - CONTEXT_LINES);
        const end = Math.min(lines.length, i + CONTEXT_LINES + 1);
        for (let idx = start; idx < end; idx++) {
          matchedIndices.add(idx);
        }
      }
    });
  });

  if (matchedIndices.size === 0) return [];

  const sorted = [...matchedIndices].sort((a, b) => a - b);
  const paragraphs = [];
  let current = [lines[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      current.push(lines[sorted[i]]);
    } else {
      paragraphs.push(current.join(" "));
      current = [lines[sorted[i]]];
    }
  }
  paragraphs.push(current.join(" "));
  return paragraphs;
}

async function generateAnswer(question, paragraphs) {
  const context = paragraphs.join("\n\n");

const prompt = `
You are an AI tutor. Answer the question using ONLY the information in the text below. You can use your own words to make the answer clear and accurate.
If the answer is not present, respond exactly with "Not in textbook."
Provide a clear and concise answer in 3-4 sentences. Do not write anything else other than the answer.
If the question requires only a 1-line answer, give just 1 line without unnecessary details.

Textbook Content:
${context}

Question:
${question}
`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`
    },
    body: JSON.stringify({
      model: "xiaomi/mimo-v2-flash:free",
      messages: [
        { role: "system", content: "You answer strictly from textbook content." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2
    })
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "Not in textbook.";
}

app.post("/ask", async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ answer: "No question provided" });
    }

    sendToDiscord(`👤 **User Question:**\n${question}`);

    const paragraphs = retrieveParagraphs(question);
    if (paragraphs.length === 0) {
      sendToDiscord(`🤖 **AI Answer:**\nNot in textbook.`);
      return res.json({ answer: "Not in textbook." });
    }

    const answer = await generateAnswer(question, paragraphs);

    sendToDiscord(`🤖 **AI Answer:**\n${answer}`);

    res.json({ answer });

  } catch (err) {
    console.error(err);

    sendToDiscord("❌ **Server Error:** Could not generate answer.");

    res.status(500).json({ answer: "Error generating answer." });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Textbook AI server running on http://localhost:${PORT}`);
});
