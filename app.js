import express from "express";
import bodyParser from "body-parser";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import csv from "csv-parser";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";
dotenv.config();
import OpenAI from "openai";

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});
const pinecone = new Pinecone({
	apiKey: process.env.PINECONE_API_KEY,
});
const indexName = "second";
const pinecone_host = process.env.PINECONE_HOST;
const index = pinecone.Index(indexName, pinecone_host);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const extractCategoriesFromText = async (text) => {
	const prompt = `Extract or predict the following information from the given resume text:
- Roles: the roles held by the individual (e.g., Software Engineer, Project Manager).
- Skills: the technical skills possessed by the individual (e.g., Java, Python, Project Management).
- Seniority: extract or predict the seniority level from experience, technologies, etc. (e.g., Junior, Mid-level, Senior, or years of experience).
- Industry: the industry/industries related to the experience (e.g., IT, Finance, Healthcare).
Return the information as JSON with keys 'roles', 'skills', 'seniority', 'industry'. Ensure none of the fields are empty or unknown, make reasonable predictions if necessary.

Resume:
${text}`;

	const response = await openai.chat.completions.create({
		model: "gpt-4o-mini",
		messages: [{ role: "user", content: prompt }],
		max_tokens: 300,
	});

	const extractedData = JSON.parse(response.choices[0].message.content);
	return extractedData;
};

const generateCategoryEmbeddings = async (categories) => {
	const embeddings = {};

	for (const [category, text] of Object.entries(categories)) {
		const response = await openai.embeddings.create({
			input: text,
			model: "text-embedding-ada-002",
		});
		embeddings[category] = response.data[0].embedding;
	}
	return embeddings;
};

const parseCSVFile = (csvPath, columns) => {
	return new Promise((resolve, reject) => {
		const data = new Set();
		let count = 0;

		fs.createReadStream(csvPath)
			.pipe(csv())
			.on("data", (row) => {
				count++;
				if (count % 50 === 0) {
					const text = columns
						.map((col) => `${col}: ${row[col]}`)
						.join(". ");
					data.add(text);
				}
			})
			.on("end", () => {
				resolve(Array.from(data));
			})
			.on("error", (err) => {
				reject(err);
			});
	});
};

const storeEmbeddingsInPinecone = async (medicines) => {
	for (let i = 0; i < medicines.length; i++) {
		const med = medicines[i];
		const categories = await extractCategoriesFromText(med);
		const categoryEmbeddings = await generateCategoryEmbeddings(categories);

		for (const [category, embedding] of Object.entries(
			categoryEmbeddings
		)) {
			await index.upsert([
				{
					id: `medicine_${i}_${category}`,
					values: embedding,
					metadata: { id: i, med, category },
				},
			]);
		}
	}
	console.log("Embeddings generated and stored in Pinecone.");
};

app.post("/generate-embeddings", async (req, res) => {
	const csvPath = path.join(__dirname, "docs", "medicine_dataset.csv");
	const columns = [
		"id",
		"name",
		"substitute0",
		"substitute1",
		"substitute2",
		"substitute3",
		"substitute4",
		"sideEffect0",
		"sideEffect1",
		"sideEffect2",
		"sideEffect3",
		"sideEffect4",
		"sideEffect5",
		"sideEffect6",
		"sideEffect7",
		"sideEffect8",
		"sideEffect9",
		"sideEffect10",
		"sideEffect11",
		"sideEffect12",
		"sideEffect13",
		"sideEffect14",
		"sideEffect15",
		"sideEffect16",
		"sideEffect17",
		"sideEffect18",
		"sideEffect19",
		"sideEffect20",
		"sideEffect21",
		"sideEffect22",
		"sideEffect23",
		"sideEffect24",
		"sideEffect25",
		"sideEffect26",
		"sideEffect27",
		"sideEffect28",
		"sideEffect29",
		"sideEffect30",
		"sideEffect31",
		"sideEffect32",
		"sideEffect33",
		"sideEffect34",
		"sideEffect35",
		"sideEffect36",
		"sideEffect37",
		"sideEffect38",
		"sideEffect39",
		"sideEffect40",
		"sideEffect41",
		"use0",
		"use1",
		"use2",
		"use3",
		"use4",
		"Chemical Class",
		"Habit Forming",
		"Therapeutic Class",
		"Action Class",
	];

	try {
		const data = await parseCSVFile(csvPath, columns);
		await storeEmbeddingsInPinecone(data);
		res.send("Embeddings generated and stored in Pinecone.");
	} catch (error) {
		console.error("Error generating embeddings:", error);
		res.status(500).send("Error generating embeddings.");
	}
});

const generateResponse = async (queryText, topCandidates) => {
	const candidateData = topCandidates.map((candidate) => ({
		id: candidate[1].id,
		text: candidate[1].text,
	}));
	const candidatesJSON = JSON.stringify(candidateData);
	const prompt = `User query:

"${queryText}"

Among the following candidates, identify those who match the user's query the most, and return their 'id' and 'text':
Candidates:
${candidatesJSON}

Please provide the matching candidates as a JSON array of objects with keys 'id' and 'text'.`;

	const response = await openai.chat.completions.create({
		model: "gpt-4",
		messages: [{ role: "user", content: prompt }],
		max_tokens: 1000,
	});

	const matchingCandidates = JSON.parse(response.choices[0].message.content);
	return matchingCandidates;
};

app.post("/query", async (req, res) => {
	const { queryText } = req.body;
	try {
		const extractedCategories = await extractCategoriesFromText(queryText);
		const queryEmbeddings = await generateCategoryEmbeddings(
			extractedCategories
		);
		const categories = ["roles", "skills", "seniority", "industry"]; // NEED TO BE CHANGED

		const candidateScores = {};
		for (const category of categories) {
			const queryEmbedding = queryEmbeddings[category];
			const results = await index.query({
				vector: queryEmbedding,
				topK: 10,
				includeMetadata: true,
				filter: { category },
			});

			results.matches.forEach((match) => {
				candidateScores[match.metadata.id] = candidateScores[
					match.metadata.id
				] || {
					id: match.metadata.id,
					score: 0,
					text: match.metadata.text,
				};

				candidateScores[match.metadata.id].score += match.score;
			});
		}

		const topCandidates = Object.entries(candidateScores)
			.sort((a, b) => b[1].score - a[1].score)
			.slice(0, 10);

		if (topCandidates.length === 0) {
			return res.json({
				status: "notfound",
				message: "No relevant matches found.",
			});
		}

		const detailedResponse = await generateResponse(
			queryText,
			topCandidates
		);
		console.log("detailedResponse", detailedResponse);
		return res.json({
			status: "success",
			candidates: topCandidates,
			detailedResponse,
		});
	} catch (error) {
		console.error("Error querying Pinecone:", error);
		res.status(500).send("Error querying Pinecone.");
	}
});

app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
	console.log(`Server running on http://localhost:${port}`);
});
