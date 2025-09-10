// scripts/knowledgeBase.js

let knowledgeBase = [];

/**
 * Loads the pre-processed knowledge base from a JSON file.
 * This should be called once when the application initializes.
 */
export async function loadKnowledgeBase() {
    try {
        const response = await fetch('./knowledge_base.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        knowledgeBase = await response.json();
        console.log('Custom knowledge base loaded successfully with', knowledgeBase.length, 'entries.');
    } catch (error) {
        console.warn('Could not load custom knowledge base. AI Assistant will rely on its general knowledge.', error);
        knowledgeBase = []; // Ensure it's empty on failure
    }
}

/**
 * Searches the knowledge base for content relevant to the user's query.
 * This is a simple keyword-based search that scores entries based on matching words.
 * @param {string} query - The user's message.
 * @param {number} [maxResults=3] - The maximum number of relevant chunks to return.
 * @returns {Array<object>} An array of the most relevant knowledge base entries.
 */
export function searchKnowledgeBase(query, maxResults = 3) {
    if (knowledgeBase.length === 0) {
        return [];
    }

    const queryWords = new Set(query.toLowerCase().match(/\b(\w+)\b/g) || []);
    if (queryWords.size === 0) {
        return [];
    }
    
    // Stop words to ignore common, non-descriptive words
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'in', 'on', 'what', 'how', 'who', 'where', 'when', 'why', 'and', 'or', 'but', 'of', 'to', 'for', 'it', 'with', 'can', 'you']);
    queryWords.forEach(word => {
        if (stopWords.has(word) || word.length < 3) {
            queryWords.delete(word);
        }
    });

    const scores = knowledgeBase.map((entry, index) => {
        const contentWords = new Set(entry.content.toLowerCase().match(/\b(\w+)\b/g) || []);
        const topicWords = new Set(entry.topic.toLowerCase().match(/\b(\w+)\b/g) || []);
        
        let score = 0;
        queryWords.forEach(qWord => {
            if (contentWords.has(qWord)) {
                score++;
            }
            // Give more weight to matches in the 'topic' field
            if (topicWords.has(qWord)) {
                score += 3;
            }
        });

        return { score, index };
    });

    // Filter out entries with no score, sort by score, take the top results, and return the original objects
    return scores
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults)
        .map(item => knowledgeBase[item.index]);
}