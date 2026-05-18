from pathlib import Path
from pypdf import PdfReader

pdf_path = Path(r"C:\Users\Administrator\Desktop\mainpaper\failed\pdf040.pdf")

reader = PdfReader(str(pdf_path))
page_count = len(reader.pages)

print(f"page_count is {page_count}")