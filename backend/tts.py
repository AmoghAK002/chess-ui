import sys
from gtts import gTTS

text = sys.argv[1]
output_file = sys.argv[2]

tts = gTTS(text=text, lang="en", slow=False)
tts.save(output_file)

print(f"TTS generated: {output_file}")