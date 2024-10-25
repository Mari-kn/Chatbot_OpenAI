import express from "express";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";

import { generateEmbeddings, query } from "./openai.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

/** routes */
app.post("/generate-embeddings", async (req, res) => {
	try {
		await generateEmbeddings();
		res.send("Embeddings generated and stored in Pinecone.");
	} catch (error) {
		console.error("Error generating embeddings:", error);
		res.status(500).send("Error generating embeddings.");
	}
});

// app.post("/query", async (req, res) => {
// 	const { queryText } = req.body;
// 	try {
// 		const data = await query(queryText);
// 		return res.send(data);
// 	} catch (error) {
// 		console.error("Error querying Pinecone:", error);
// 		res.status(500).send("Error querying Pinecone.");
// 	}
// });

app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "index.html"));
});

export default app;
