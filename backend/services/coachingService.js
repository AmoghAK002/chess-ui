function generateFallbackCoaching(
    evaluation,
    san,
    bestMoveBefore,
    bestResponseAfter,
    playerColor
) {
    const quality = evaluation?.quality;

    if (quality === "best_move") {
        return {
            narrative: `${san} is a strong move. It is the best move available in this position and keeps your position in the best shape.`,
            segments: [
                {
                    text: `${playerColor === "WHITE" ? "White" : "Black"} played ${san}. This is the strongest move in the position.`,
                    move: null,
                },
            ],
        };
    }

    if (quality === "excellent") {
        return {
            narrative: `${san} is an excellent move. It gives up only a very small amount compared with the strongest choice.`,
            segments: [
                {
                    text: `${san} is an excellent move and stays very close to the strongest choice.`,
                    move: null,
                },
            ],
        };
    }

    if (quality === "good") {
        return {
            narrative: `${san} is a good move. It keeps your position healthy, although there was a slightly stronger option available.`,
            segments: [
                {
                    text: `${san} is a good move, although ${bestMoveBefore || "another move"} was slightly stronger.`,
                    move: null,
                },
            ],
        };
    }

    if (quality === "inaccuracy") {
        return {
            narrative: `${san} is playable, but it gives up some of the advantage available in the position. A stronger option was ${bestMoveBefore || "available"}.`,
            segments: [
                {
                    text: `${san} is playable, but ${bestMoveBefore || "a stronger move"} would have kept the position more favorable.`,
                    move: null,
                },
            ],
        };
    }

    if (quality === "mistake") {
        return {
            narrative: `${san} is a mistake because it loses a noticeable amount of evaluation. ${bestMoveBefore || "A stronger move was available"} would have preserved a better position.`,
            segments: [
                {
                    text: `${san} is a mistake. ${bestMoveBefore || "A stronger move"} would have been better.`,
                    move: null,
                },
            ],
        };
    }

    if (quality === "blunder") {
        return {
            narrative: `${san} is a serious mistake and significantly worsens your position. ${bestMoveBefore || "A stronger move was available"} should have been considered.`,
            segments: [
                {
                    text: `${san} is a serious mistake. Look for ${bestMoveBefore || "a stronger alternative"} instead.`,
                    move: null,
                },
            ],
        };
    }

    return {
        narrative: `I could not generate the full coaching explanation right now, but your move was ${san}.`,
        segments: [
            {
                text: `You played ${san}.`,
                move: null,
            },
        ],
    };
}

module.exports = {
    generateFallbackCoaching,
};