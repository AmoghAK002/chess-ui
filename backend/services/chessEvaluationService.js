function getPlayerScore(score, playerColor) {
    if (typeof score !== "number") {
        return null;
    }

    if (playerColor === "w") {
        return score;
    }

    if (playerColor === "b") {
        return -score;
    }

    return null;
}

function calculateEvaluationLoss(bestScore, actualScore) {
    if (bestScore === null || actualScore === null) {
        return null;
    }

    const loss = bestScore - actualScore;

    return Math.max(0, loss);
}

function evaluateMoveQuality(bestScore, actualScore, playerColor) {
    const playerBestScore = getPlayerScore(bestScore, playerColor);
    const playerActualScore = getPlayerScore(actualScore, playerColor);

    const evaluationLoss = calculateEvaluationLoss(
        playerBestScore,
        playerActualScore
    );

    return {
        bestScore: playerBestScore,
        actualScore: playerActualScore,
        evaluationLoss,
    };
}

module.exports = {
    getPlayerScore,
    calculateEvaluationLoss,
    evaluateMoveQuality,
};