
import os
import struct

class BinaryService:
    # Addresses from User Screenshots (MSS54HP CSL)
    ADDR_INTAKE_VANOS = 0x1910  # KF_EVAN1_SOLL (16x16)
    ADDR_EXHAUST_VANOS = 0x1C36 # KF_AVAN1_SOLL (16x16)
    
    # Axis Addresses
    ADDR_INTAKE_AXIS_X = 0x18D0    # Columns
    ADDR_INTAKE_AXIS_Y = 0x18F0    # Rows
    
    ADDR_EXHAUST_AXIS_X = 0x1BF6   # Columns (from image)
    ADDR_EXHAUST_AXIS_Y = 0x1C16   # Rows (from image)
    
    # VE Map (Alpha-N for CSL)
    ADDR_VE_MAP = 0xD356
    ADDR_VE_AXIS_RPM = 0xD2FE  # 20 Columns
    ADDR_VE_AXIS_LOAD = 0xD326 # 24 Rows
    
    # Conversion Factor: 0-65535 -> 0-160% (Typical MSS54 VE Scale)
    VE_FACTOR = 160.0 / 65535.0

    def __init__(self):
        pass

    def read_binary(self, file_path):
        """Reads the full binary into a mutable bytearray."""
        with open(file_path, 'rb') as f:
            return bytearray(f.read())

    def save_binary(self, file_path, data):
        """Saves the bytearray back to disk."""
        with open(file_path, 'wb') as f:
            f.write(data)

    def read_axis(self, binary_data, address, length):
        """Reads a 1D axis of 16-bit unsigned integers."""
        axis = []
        offset = address
        for _ in range(length):
            val = struct.unpack_from('<H', binary_data, offset)[0]
            axis.append(val)
            offset += 2
        return axis

    def read_table_generic(self, binary_data, address, rows, cols, factor=1.0):
        """
        Reads a Rows x Cols table of 16-bit unsigned integers.
        Apply factor to convert raw values.
        Returns list of lists (rows).
        """
        table = []
        offset = address
        for r in range(rows):
            row_data = []
            for c in range(cols):
                val = struct.unpack_from('<H', binary_data, offset)[0]
                row_data.append(val * factor)
                offset += 2
            table.append(row_data)
        return table

    def read_table_16x16(self, binary_data, address):
        """
        Reads a 16x16 table of 8-bit signed integers.
        Returns a list of lists (16 rows, 16 cols).
        """
        table = []
        offset = address
        for row in range(16):
            row_data = []
            for col in range(16):
                # Read 1 byte, signed
                val = struct.unpack_from('<b', binary_data, offset)[0]
                row_data.append(val)
                offset += 1
            table.append(row_data)
        return table

    def read_table_16x16_uint16(self, binary_data, address):
        """
        Reads a 16x16 table of 16-bit unsigned integers (Common for VE).
        """
        table = []
        offset = address
        for row in range(16):
            row_data = []
            for col in range(16):
                val = struct.unpack_from('<H', binary_data, offset)[0]
                row_data.append(val)
                offset += 2
            table.append(row_data)
        return table

    def write_table_16x16(self, binary_data, address, table_data):
        """
        Writes a 16x16 table of 8-bit signed integers back to binary_data.
        table_data: list of lists.
        """
        offset = address
        for row in range(16):
            for col in range(16):
                val = int(table_data[row][col])
                # Clamp to 8-bit signed range (-128 to 127) just in case
                val = max(-128, min(127, val))
                struct.pack_into('<b', binary_data, offset, val)
                offset += 1

    def apply_vanos_bias(self, binary_data, address, bias_deg):
        """
        Applies a uniform bias (in raw units) to the entire table.
        """
        current_table = self.read_table_16x16(binary_data, address)
        
        # Modify
        for r in range(16):
            for c in range(16):
                # Naive patch: Add bias
                new_val = current_table[r][c] + int(bias_deg)
                current_table[r][c] = new_val
        
        # Write back
        self.write_table_16x16(binary_data, address, current_table)
        return current_table

