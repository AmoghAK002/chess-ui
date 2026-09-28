const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
});

async function generateGeminiContent(prompt) {
    const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
    });

    return response;
}

async function generateGeminiJson(prompt) {
    const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
            responseMimeType: "application/json",
        },
    });

    return response;
}
async function generateGeminiTTS(text) {
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: text,
        config: {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: "Algenib",
                    },
                },
            },
        },
    });

    return response;
}

async function generateGeminiJsonWithRetry(prompt, maxAttempts = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await generateGeminiJson(prompt);
        } catch (error) {
            lastError = error;

            console.log(
                `Gemini request failed (attempt ${attempt}/${maxAttempts}):`,
                error.message
            );

            if (attempt < maxAttempts) {
                const delay = attempt * 1000;

                console.log(`Retrying Gemini in ${delay}ms...`);

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw lastError;
}

module.exports = {
    ai,
    generateGeminiContent,
    generateGeminiJson,
    generateGeminiTTS,
    generateGeminiJsonWithRetry,
};