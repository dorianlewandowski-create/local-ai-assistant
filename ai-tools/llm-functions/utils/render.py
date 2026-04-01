import sys
import argparse
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.markdown import Markdown
from rich.text import Text

console = Console()

def print_panel(content, title=None, style="blue"):
    console.print(Panel(content, title=title, style=style, expand=True))

def print_table(content, title=None):
    # content format: "Header1,Header2|Row1Col1,Row1Col2|Row2Col1,Row2Col2"
    lines = content.split('|')
    if not lines:
        return
    
    headers = [h.strip() for h in lines[0].split(',')]
    table = Table(title=title, show_header=True, header_style="bold magenta")
    
    for header in headers:
        table.add_column(header)
        
    for line in lines[1:]:
        row = [r.strip() for r in line.split(',')]
        if len(row) == len(headers):
            table.add_row(*row)
            
    console.print(table)

def print_md(content):
    console.print(Markdown(content))

def main():
    parser = argparse.ArgumentParser(description="Rich Terminal Renderer")
    parser.add_argument("--type", choices=["panel", "table", "md"], required=True)
    parser.add_argument("--content", required=True)
    parser.add_argument("--title", help="Optional title for panel or table")
    parser.add_argument("--style", default="blue", help="Style for the panel")
    
    args = parser.parse_args()
    
    if args.type == "panel":
        print_panel(args.content, args.title, args.style)
    elif args.type == "table":
        print_table(args.content, args.title)
    elif args.type == "md":
        print_md(args.content)

if __name__ == "__main__":
    main()
