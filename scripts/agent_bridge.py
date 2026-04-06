import os
import sys
import json
import subprocess
import tempfile
from pathlib import Path

# Configuration
MODEL = "qwen2.5-coder:7b" 
BIN_DIR = Path.home() / "local-ai-assistant/ai-tools/llm-functions/bin"

# Expanded Tools
REGISTERED_TOOLS = [
    "calendar_list_events", 
    "reminders_list_items", 
    "mail_recent", 
    "mail_search", 
    "db_project_status",
    "send_imessage",
    "send_email",
    "get_current_weather"
]

def run_tool(name, args={}):
    tool_path = BIN_DIR / name
    if not tool_path.exists():
        tool_path = Path.home() / f"local-ai-assistant/ai-tools/llm-functions/tools/{name}.sh"
    
    if not tool_path.exists():
        return f"Error: Tool {name} not found."

    with tempfile.NamedTemporaryFile(mode='w+', delete=False) as tmp:
        tmp_path = tmp.name

    try:
        args_json = json.dumps(args)
        env = os.environ.copy()
        env["LLM_ROOT_DIR"] = str(Path.home() / "local-ai-assistant/ai-tools/llm-functions")
        env["LLM_OUTPUT"] = tmp_path
        
        proc = subprocess.run([str(tool_path), args_json], capture_output=True, text=True, env=env)
        
        with open(tmp_path, 'r') as f:
            result = f.read().strip()
            
        os.unlink(tmp_path)
        
        if result:
            return result
        elif proc.stdout:
            return proc.stdout.strip()
        else:
            return "Task completed successfully."
            
    except Exception as e:
        if os.path.exists(tmp_path): os.unlink(tmp_path)
        return f"Execution Error: {str(e)}"

def process_request(user_request):
    print("\033[90m[*] AIChat Intelligence Engine processing...\033[0m")
    
    prompt = f"""
    SYSTEM: You are the AIChat System Controller.
    AVAILABLE TOOLS: {', '.join(REGISTERED_TOOLS)}
    USER REQUEST: {user_request}
    INSTRUCTION: If a tool is needed, respond ONLY with a JSON object. Otherwise answer normally.
    """
    
    try:
        response_raw = subprocess.run([
            "curl", "-s", "http://localhost:11434/api/generate",
            "-d", json.dumps({"model": MODEL, "prompt": prompt, "stream": False})
        ], capture_output=True, text=True).stdout
        ai_msg = json.loads(response_raw)['response'].strip()
    except Exception as e:
        print(f"\033[91mError: Could not talk to Ollama ({e})\033[0m")
        return

    if "{" in ai_msg and "tool" in ai_msg:
        try:
            json_start = ai_msg.find("{")
            json_end = ai_msg.rfind("}") + 1
            tool_call = json.loads(ai_msg[json_start:json_end])
            
            tool_name = tool_call['tool']
            tool_args = tool_call.get('args', {})
            
            print(f"\033[94m[*] System Action: {tool_name}...\033[0m")
            tool_output = run_tool(tool_name, tool_args)
            
            print(f"\033[92m[+] Data Retrieved: {tool_output}\033[0m")
            
            final_prompt = f"User asked: {user_request}\nSystem data: {tool_output}\nSummarize this for the user."
            final_response_raw = subprocess.run([
                "curl", "-s", "http://localhost:11434/api/generate",
                "-d", json.dumps({"model": MODEL, "prompt": final_prompt, "stream": False})
            ], capture_output=True, text=True).stdout
            
            print("\n" + json.loads(final_response_raw)['response'].strip() + "\n")
            
        except Exception as e:
            print(f"\n\033[91m[!] Error: {e}\033[0m")
    else:
        print("\n" + ai_msg + "\n")

def main():
    if len(sys.argv) > 1:
        process_request(" ".join(sys.argv[1:]))
        return

    print("\033[1mWelcome to AIChat (Local OS Bridge)\033[0m")
    print("Type 'exit' to leave.\n")
    while True:
        try:
            user_input = input("aichat> ")
            if user_input.lower() in ['exit', 'quit', '.exit']: break
            if not user_input.strip(): continue
            process_request(user_input)
        except (KeyboardInterrupt, EOFError): break

if __name__ == "__main__":
    main()
