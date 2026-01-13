
import os

def check_offset(filename, offset, context=50):
    if not os.path.exists(filename):
        print(f"File not found: {filename}")
        return
        
    file_size = os.path.getsize(filename)
    print(f"File: {filename}, Size: {file_size}")
    
    with open(filename, "rb") as f:
        # Read around offset
        start = max(0, offset - context)
        length = (offset + context) - start
        f.seek(start)
        data = f.read(length)
        
        print(f"\n--- Content around Offset {offset} ---")
        print(f"Start: {start}")
        print("-" * 20)
        try:
            text = data.decode('utf-8', errors='replace')
            # Mark offset
            rel_offset = offset - start
            print(text)
            print("-" * 20)
            print(f"Offset pointer: '{text[rel_offset:rel_offset+1]}'")
        except Exception as e:
            print(f"Error decoding: {e}")
            print(data)

if __name__ == "__main__":
    # Check Offset 699 (Pipe 2 Start from Log)
    check_offset("base_model.wam", 699, 100)
