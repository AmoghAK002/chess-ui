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

module.exports = {
    ai,
    generateGeminiContent,
    generateGeminiJson,
    generateGeminiTTS,
};