import { fileURLToPath } from "url";
import fs from "fs";
import csv from "csv-parser";
import path from "path";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

const pinecone = new Pinecone({
	apiKey: process.env.PINECONE_API_KEY,
});
const indexName = "medicines";
const pinecone_host = process.env.PINECONE_HOST;
const index = pinecone.Index(indexName, pinecone_host);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extractCategoriesFromText = async (data) => {
	const response = await openai.chat.completions.create({
		model: "gpt-4o",
		messages: [
			{
				role: "system",
				content:
					"You extract information from a medicine dataset and return them in a structured JSON format.",
			},
			{
				role: "user",
				content: `Extract or predict the following information from the given the data:
  							- Side effects: what are the possible side efffect of the medication.
  
							Data:
							${data}`,
			},
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "medicine_extraction_schema",
				schema: {
					type: "object",
					properties: {
						sideEffects: {
							description: "Side effects",
							type: "string",
						},
					},
					required: ["sideEffects"],
					additionalProperties: false,
				},
			},
		},
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
		const data = [];

		fs.createReadStream(csvPath)
			.pipe(csv())
			.on("data", (row) => data.push(row))

			.on("end", () => {
				resolve(data);
			})
			.on("error", (err) => {
				reject(err);
			});
	});
};

const storeEmbeddingsInPinecone = async (medicines) => {
	for (let i = 0; i < medicines.length; i++) {
		const med = medicines[i];
		const categories = await extractCategoriesFromText(JSON.stringify(med));
		const categoryEmbeddings = await generateCategoryEmbeddings(categories);

		for (const [category, embedding] of Object.entries(
			categoryEmbeddings
		)) {
			await index.upsert([
				{
					id: `medicine_${i}_${category}`,
					values: embedding,
					metadata: {
						id: i,
						name: med.name,
						content: categories[category],
						category,
					},
				},
			]);
		}
	}
};

export async function generateEmbeddings() {
	const csvPath = path.join(
		__dirname,
		"docs",
		"medicine_dataset_reduced.csv"
	);
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

	const data = await parseCSVFile(csvPath, columns);
	await storeEmbeddingsInPinecone(data);
}

const generateResponse = async (queryText, topMedicines) => {
	const medicinesJSON = JSON.stringify(topMedicines);

	const prompt = `
		You are a helpful doctor assistant who needs to identify the medicine that is causing the pacient symptoms. 
		The medicines that the doctor needs to analyse is : ${medicinesJSON}`;

	const response = await openai.chat.completions.create({
		model: "gpt-4",
		messages: [
			{ role: "user", content: prompt },
			{
				role: "user",
				content: `What medicines corresponde better if the doctor search "${queryText}`,
			},
		],
		max_tokens: 1000,
	});

	return response.choices[0].message.content;
};

export async function query(queryText) {
	const extractedCategories = await extractCategoriesFromText(queryText);
	const queryEmbeddings = await generateCategoryEmbeddings(
		extractedCategories
	);
	const categories = ["sideEffects"];

	const medicineScores = {};
	for (const category of categories) {
		const queryEmbedding = queryEmbeddings[category];
		const results = await index.query({
			vector: queryEmbedding,
			topK: 10,
			includeMetadata: true,
			filter: { category },
		});
		results.matches.forEach((match) => {
			medicineScores[match.metadata.id] = medicineScores[
				match.metadata.id
			] || {
				id: match.metadata.id,
				score: 0,
				medicine: match.metadata.name,
				sideEffects: match.metadata.content,
			};

			medicineScores[match.metadata.id].score += match.score;
		});
	}

	const topMedicines = Object.values(medicineScores)
		.sort((a, b) => b.score - a.score)
		.slice(0, 10);

	console.log(`Found ${topMedicines.length} top medicines.`);
	console.log(
		`Ordered by score: ${topMedicines
			.map((medicine) => `ID: ${medicine.id}, Score: ${medicine.score}`)
			.join("\n")}`
	);

	if (topMedicines.length === 0) {
		return {
			status: "notfound",
			message: "No relevant matches found.",
		};
	}

	const detailedResponse = await generateResponse(queryText, topMedicines);
	return {
		status: "success",
		medicines: topMedicines,
		detailedResponse,
	};
}
