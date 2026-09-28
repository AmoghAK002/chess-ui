// Converts a Stockfish score into the player's perspective.
// Stockfish reports the score from the current side-to-move's perspective.
// If the player is the side to move, the score stays the same.
// If the opponent is the side to move, the score is reversed.
// Mate scores are handled using the same perspective rule.
function getPlayerScore(score, playerColor, sideToMove) {
    if (typeof score !== "number" && !isMateScore(score)) {
        return null;
    }

    if (playerColor === sideToMove) {
        return score;
    }

    if (typeof score === "number") {
        return -score;
    }

    const mateNumber = getMateScore(score);

    if (mateNumber === null) {
        return null;
    }

    return `mate ${-mateNumber}`;
}

// Checks whether a Stockfish score represents a forced checkmate
// instead of a normal centipawn evaluation.
// Example: "mate 3" or "mate -2" → true
// Example: 44 or -37 → false
function isMateScore(score) {
    return typeof score === "string" && score.startsWith("mate ");
}

// Extracts the number of moves from a Stockfish mate score.
// Example: "mate 3" → 3
// Example: "mate -2" → -2
// Returns null if the score is not a valid mate score.
function getMateScore(score) {
    if (!isMateScore(score)) {
        return null;
    }

    const mateNumber = Number(score.substring(5));

    return Number.isNaN(mateNumber) ? null : mateNumber;
}

// Calculates how much evaluation the player lost by choosing their actual move
// instead of the engine's best move.
//
// Normal centipawn scores use numerical subtraction.
// Mate scores are handled separately because "mate 3" is not a normal number.
function calculateEvaluationLoss(bestScore, actualScore) {
    if (bestScore === null || actualScore === null) {
        return null;
    }

    // Handle normal Stockfish centipawn evaluations.
    if (typeof bestScore === "number" && typeof actualScore === "number") {
        const loss = bestScore - actualScore;

        return Math.max(0, loss);
    }

    // Mate scores need special handling because they are strings,
    // such as "mate 3" or "mate -2".
    if (isMateScore(bestScore) || isMateScore(actualScore)) {
        return null;
    }

    return null;
}

// Classifies a normal centipawn evaluation loss into a
// human-readable move-quality category.
//
// The thresholds are configurable engineering defaults.
// They can be tuned later using real game data.
function classifyEvaluationLoss(evaluationLoss) {
    if (evaluationLoss === null) {
        return null;
    }

    if (evaluationLoss === 0) {
        return "best_move";
    }

    if (evaluationLoss <= 20) {
        return "excellent";
    }

    if (evaluationLoss <= 50) {
        return "good";
    }

    if (evaluationLoss <= 100) {
        return "inaccuracy";
    }

    if (evaluationLoss <= 200) {
        return "mistake";
    }

    return "blunder";
}

// Classifies a position where Stockfish reports a forced checkmate.
//
// Mate scores are different from centipawn scores:
//
// "mate 3"  → the player can force checkmate in 3 moves.
// "mate 5"  → the player can force checkmate in 5 moves.
// "mate -3" → the player is getting checkmated in 3 moves.
//
// The outcome change is handled separately because
// winning → losing is much more serious than simply
// increasing the mate distance.
function classifyMateEvaluation(mateLoss, mateOutcomeChange) {
    // A winning position becoming losing is a major error.
    if (mateOutcomeChange === "win_to_loss") {
        return "blunder";
    }

    // A losing position becoming winning is a very positive change.
    if (mateOutcomeChange === "loss_to_win") {
        return "best_move";
    }

    // If there is no mate-distance information, we cannot classify it.
    if (mateLoss === null) {
        return null;
    }

    // The player still has a forced mate and the distance did not worsen.
    if (mateLoss === 0) {
        return "best_move";
    }

    // The player still wins, but the move makes the forced mate longer.
    // For now, every positive mate-distance deterioration is classified
    // as a mistake. We can tune this later with real game data.
    return "mistake";
}

// Calculates the deterioration when both Stockfish scores are mate scores.
// Mate scores are already expressed from the player's perspective.
//
// Positive mate number  → the player can force mate.
// Negative mate number  → the player is getting mated.
//
// We return the difference in mate distance when both positions
// have the same winning/losing direction.
// If the position changes from winning to losing (or losing to winning),
// we return null for now because that is a separate, more serious
// classification that we will handle explicitly later.
function calculateMateLoss(bestScore, actualScore) {
    if (!isMateScore(bestScore) || !isMateScore(actualScore)) {
        return null;
    }

    const bestMate = getMateScore(bestScore);
    const actualMate = getMateScore(actualScore);

    if (bestMate === null || actualMate === null) {
        return null;
    }

    // Best move and actual move are both winning for the player.
    // Example: mate 3 → mate 5 means the player still wins,
    // but the win takes 2 more moves.
    if (bestMate > 0 && actualMate > 0) {
        return Math.max(0, actualMate - bestMate);
    }

    // Best move and actual move are both losing for the player.
    // Example: mate -5 → mate -2 means the player still loses,
    // but the actual position reaches mate sooner.
    if (bestMate < 0 && actualMate < 0) {
        return Math.max(0, Math.abs(bestMate) - Math.abs(actualMate));
    }

    // Winning → losing or losing → winning needs separate handling.
    return null;
}

// Detects whether a move changes the player's position
// from winning to losing, or from losing to winning.
//
// Positive mate score  → player can force mate.
// Negative mate score  → player is getting mated.
// A change in sign therefore represents a major change
// in the outcome of the position.
function getMateOutcomeChange(bestScore, actualScore) {
    if (!isMateScore(bestScore) || !isMateScore(actualScore)) {
        return null;
    }

    const bestMate = getMateScore(bestScore);
    const actualMate = getMateScore(actualScore);

    if (bestMate === null || actualMate === null) {
        return null;
    }

    // Best move wins, but the actual move loses.
    if (bestMate > 0 && actualMate < 0) {
        return "win_to_loss";
    }

    // Best move loses, but the actual move wins.
    if (bestMate < 0 && actualMate > 0) {
        return "loss_to_win";
    }

    // Both scores have the same outcome direction.
    return null;
}

// Evaluates the player's actual move against Stockfish's best move.
//
// The function:
// 1. Converts both Stockfish scores into the player's perspective.
// 2. Calculates normal centipawn loss.
// 3. Calculates mate-distance loss.
// 4. Detects winning/losing outcome changes.
// 5. Converts those measurements into a human-readable quality.
function evaluateMoveQuality(
    bestScore,
    actualScore,
    playerColor,
    beforeSideToMove,
    afterSideToMove
) {
    // Convert Stockfish's best-move score into the player's perspective.
    const playerBestScore = getPlayerScore(
        bestScore,
        playerColor,
        beforeSideToMove
    );

    // Convert Stockfish's actual-position score into the player's perspective.
    const playerActualScore = getPlayerScore(
        actualScore,
        playerColor,
        afterSideToMove
    );

    // Calculate normal centipawn loss.
    const evaluationLoss = calculateEvaluationLoss(
        playerBestScore,
        playerActualScore
    );

    // Calculate mate-distance loss when both scores are mate scores.
    const mateLoss = calculateMateLoss(
        playerBestScore,
        playerActualScore
    );

    // Detect a major outcome change such as winning → losing.
    const mateOutcomeChange = getMateOutcomeChange(
        playerBestScore,
        playerActualScore
    );

    let quality = null;

    // If we have a normal numerical evaluation loss,
    // use the centipawn classifier.
    if (evaluationLoss !== null) {
        quality = classifyEvaluationLoss(evaluationLoss);
    }

    // If the position involves mate scores, use the mate classifier.
    if (
        isMateScore(playerBestScore) ||
        isMateScore(playerActualScore)
    ) {
        quality = classifyMateEvaluation(
            mateLoss,
            mateOutcomeChange
        );
    }

    return {
        bestScore: playerBestScore,
        actualScore: playerActualScore,
        evaluationLoss,
        mateLoss,
        mateOutcomeChange,
        quality,
    };
}

    module.exports = {
    evaluateMoveQuality,
};