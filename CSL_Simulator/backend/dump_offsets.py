
f = open("test_verify.wam", "rb")
data = f.read()
f.close()

# Identify locations around line 984
# Search for pattern "1 0 1 25"
import re
pattern = b"\r\n1 0 1 25"
match = re.search(pattern, data)
if match:
    start = match.start()
    end = match.end()
    print(f"Line 984 '1 0 1 25' found at {start} to {end}")
    
    # Print next 50 bytes with offsets
    print("Next bytes:")
    curr = end
    for i in range(50):
        if curr + i < len(data):
            b = data[curr+i]
            c = chr(b) if 32 <= b <= 126 else '.'
            print(f"{curr+i}: {b:02X} '{c}'")
else:
    print("Pattern not found")
