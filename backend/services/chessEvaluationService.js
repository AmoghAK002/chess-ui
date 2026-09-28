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
// This function first converts both Stockfish scores into the player's
// perspective. It then determines whether the move caused:
// 1. Normal centipawn evaluation loss
// 2. Mate-distance loss
// 3. A winning → losing transition
// 4. A losing → winning transition
function evaluateMoveQuality(
    bestScore,
    actualScore,
    playerColor,
    beforeSideToMove,
    afterSideToMove
) {
    // Convert the best-move evaluation into the player's perspective.
    const playerBestScore = getPlayerScore(
        bestScore,
        playerColor,
        beforeSideToMove
    );

    // Convert the actual-position evaluation into the player's perspective.
    const playerActualScore = getPlayerScore(
        actualScore,
        playerColor,
        afterSideToMove
    );

    // Calculate normal centipawn loss when both scores are numerical.
    const evaluationLoss = calculateEvaluationLoss(
        playerBestScore,
        playerActualScore
    );

    // Calculate mate-distance loss when both scores are mate scores.
    const mateLoss = calculateMateLoss(
        playerBestScore,
        playerActualScore
    );

    // Detect whether the move changed the game outcome
    // from winning to losing or losing to winning.
    const mateOutcomeChange = getMateOutcomeChange(
        playerBestScore,
        playerActualScore
    );

    return {
        bestScore: playerBestScore,
        actualScore: playerActualScore,
        evaluationLoss,
        mateLoss,
        mateOutcomeChange,
    };
}

// Normal centipawn loss.
// Before: White to move, Stockfish = +44.
// After: Black to move, Stockfish = -37.
// From White's perspective: +44 → +37.
// Expected loss: 7.
console.log(
    "NORMAL LOSS:",
    evaluateMoveQuality(44, -37, "w", "w", "b")
);

// Both positions are winning for White.
// Before: White to move, Stockfish = mate 3.
// After: Black to move, Stockfish = mate -5.
// From White's perspective: mate 3 → mate 5.
// Expected mate loss: 2.
console.log(
    "MATE DISTANCE LOSS:",
    evaluateMoveQuality("mate 3", "mate -5", "w", "w", "b")
);

// Best move wins.
// Actual move loses.
// Before: White to move, Stockfish = mate 3.
// After: Black to move, Stockfish = mate 5.
// From White's perspective: mate 3 → mate -5.
// Expected: win_to_loss.
console.log(
    "WIN TO LOSS:",
    evaluateMoveQuality("mate 3", "mate 5", "w", "w", "b")
);

// Both positions are winning for White.
// Before: White to move, Stockfish = mate 3.
// After: Black to move, Stockfish = mate -2.
// From White's perspective: mate 3 → mate 2.
// White mates faster.
// Expected mate loss: 0.
console.log(
    "MATE NO LOSS:",
    evaluateMoveQuality("mate 3", "mate -2", "w", "w", "b")
);