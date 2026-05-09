import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

api_key = os.getenv("OPENROUTER_API_KEY")
model = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct")

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=api_key,
)

response = client.chat.completions.create(
    model=model,
    messages=[
        {"role": "system", "content": "Tu es un assistant technique spécialisé en maintenance industrielle."},
        {"role": "user", "content": "Quelles sont les causes possibles d'une perte de puissance sur une CAT 994F ?"}
    ],
    temperature=0.2,
)

print(response.choices[0].message.content)