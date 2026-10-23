import os, sys, shutil

c_img_path = 'Systems/MS-DOS 6.22/c.img'
win203_img_path = 'Systems/Windows 2.03/win203.img'

# 1. Ler win203.img
with open(win203_img_path, 'rb') as f:
    wbuf = f.read()

part_start = 63 * 512
sec_per_clust = wbuf[part_start + 0x0D]
bytes_per_clust = sec_per_clust * 512
root_offset = part_start + (1 + 2*12)*512
data_start = root_offset + 512*32
wfat_offset = part_start + 512

def wget_fat(cl):
    idx = int(cl * 1.5)
    if cl % 2 == 0:
        return (wbuf[wfat_offset + idx] | (wbuf[wfat_offset + idx + 1] << 8)) & 0x0FFF
    else:
        return ((wbuf[wfat_offset + idx] >> 4) | (wbuf[wfat_offset + idx + 1] << 4)) & 0x0FFF

def wread_file(start_cl, size):
    data = bytearray()
    cl = start_cl
    while cl < 0x0FF8 and len(data) < size:
        off = data_start + (cl - 2) * bytes_per_clust
        data += wbuf[off:off+bytes_per_clust]
        cl = wget_fat(cl)
    return bytes(data[:size])

# Extrair itens da pasta WIN203
win203_entries = []
dir_off = data_start + (332 - 2) * bytes_per_clust
for i in range(128):
    off = dir_off + i*32
    if wbuf[off] == 0: break
    if wbuf[off] == 0xE5: continue
    raw_name = wbuf[off:off+11]
    name_str = raw_name.decode('ascii', errors='ignore')
    attr = wbuf[off+11]
    size = int.from_bytes(wbuf[off+28:off+32], 'little')
    cl = int.from_bytes(wbuf[off+26:off+28], 'little')
    date_bytes = wbuf[off+12:off+26]
    
    if name_str.strip() in ('.', '..'):
        continue

    if attr & 0x10: # Diretório PIF
        pif_entries = []
        pdir_off = data_start + (cl - 2) * bytes_per_clust
        for j in range(128):
            poff = pdir_off + j*32
            if wbuf[poff] == 0: break
            if wbuf[poff] == 0xE5: continue
            praw_name = wbuf[poff:poff+11]
            pname_str = praw_name.decode('ascii', errors='ignore')
            if pname_str.strip() in ('.', '..'): continue
            pattr = wbuf[poff+11]
            psize = int.from_bytes(wbuf[poff+28:poff+32], 'little')
            pcl = int.from_bytes(wbuf[poff+26:poff+28], 'little')
            pdate = wbuf[poff+12:poff+26]
            pcontent = wread_file(pcl, psize)
            pif_entries.append((praw_name, pattr, pdate, psize, pcontent))
        win203_entries.append((raw_name, attr, date_bytes, 0, pif_entries))
    else:
        content = wread_file(cl, size)
        win203_entries.append((raw_name, attr, date_bytes, size, content))

print(f'Extraídos {len(win203_entries)} itens de WIN203')

# 2. Ler c.img
with open(c_img_path, 'rb') as f:
    cbuf = bytearray(f.read())

c_fat1_offset = part_start + 512
c_fat2_offset = part_start + 512 + 12*512

def c_set_fat(cl, val):
    for base in (c_fat1_offset, c_fat2_offset):
        idx = base + int(cl * 1.5)
        if cl % 2 == 0:
            cbuf[idx] = val & 0xFF
            cbuf[idx + 1] = (cbuf[idx + 1] & 0xF0) | ((val >> 8) & 0x0F)
        else:
            cbuf[idx] = (cbuf[idx] & 0x0F) | ((val & 0x0F) << 4)
            cbuf[idx + 1] = (val >> 4) & 0xFF

# Alocador de clusters contíguos livres
next_free_cluster = 2469

def allocate_chain(data_bytes):
    global next_free_cluster
    if len(data_bytes) == 0:
        return 0
    needed_clusters = (len(data_bytes) + bytes_per_clust - 1) // bytes_per_clust
    start_cl = next_free_cluster
    clusters = []
    for i in range(needed_clusters):
        cl = next_free_cluster
        next_free_cluster += 1
        clusters.append(cl)
    
    for i in range(len(clusters)):
        cl = clusters[i]
        if i == len(clusters) - 1:
            c_set_fat(cl, 0x0FFF) # Fim de cadeia
        else:
            c_set_fat(cl, clusters[i + 1])
        # Escrever dados no cluster
        chunk = data_bytes[i * bytes_per_clust : (i + 1) * bytes_per_clust]
        off = data_start + (cl - 2) * bytes_per_clust
        cbuf[off : off + len(chunk)] = chunk
        if len(chunk) < bytes_per_clust:
            cbuf[off + len(chunk) : off + bytes_per_clust] = b'\x00' * (bytes_per_clust - len(chunk))
    return start_cl

# Criar a subpasta PIF se houver
# Primeiro gravamos os arquivos de PIF
pif_dir_cluster = 0
for item in win203_entries:
    raw_name, attr, date_bytes, size, payload = item
    if attr & 0x10: # Diretório PIF
        pif_files = payload
        # Criar dados do diretório PIF
        pif_dir_data = bytearray(bytes_per_clust) # 1 cluster para o diretório
        pif_dir_cluster = next_free_cluster
        next_free_cluster += 1
        c_set_fat(pif_dir_cluster, 0x0FFF)
        
        # Entrada '.'
        pif_dir_data[0:11] = b'.          '
        pif_dir_data[11] = 0x10
        pif_dir_data[12:26] = date_bytes
        pif_dir_data[26:28] = pif_dir_cluster.to_bytes(2, 'little')
        # Entrada '..' (vai apontar para o cluster do WIN203, preenchemos depois)
        pif_dir_data[32:43] = b'..         '
        pif_dir_data[43] = 0x10
        pif_dir_data[44:58] = date_bytes
        
        pentry_idx = 2
        for pf in pif_files:
            praw_name, pattr, pdate, psize, pcontent = pf
            pcl = allocate_chain(pcontent)
            poff = pentry_idx * 32
            pif_dir_data[poff:poff+11] = praw_name
            pif_dir_data[poff+11] = pattr
            pif_dir_data[poff+12:poff+26] = pdate
            pif_dir_data[poff+26:poff+28] = pcl.to_bytes(2, 'little')
            pif_dir_data[poff+28:poff+32] = psize.to_bytes(4, 'little')
            pentry_idx += 1
        
        # Salvar cluster do PIF
        poff = data_start + (pif_dir_cluster - 2) * bytes_per_clust
        cbuf[poff:poff+bytes_per_clust] = pif_dir_data
        break

# Agora criar o diretório WIN203
win203_dir_cluster = next_free_cluster
next_free_cluster += 1
c_set_fat(win203_dir_cluster, 0x0FFF)
win203_dir_data = bytearray(bytes_per_clust)

# Atualizar o '..' do PIF para apontar para win203_dir_cluster
if pif_dir_cluster > 0:
    poff = data_start + (pif_dir_cluster - 2) * bytes_per_clust
    cbuf[poff + 32 + 26 : poff + 32 + 28] = win203_dir_cluster.to_bytes(2, 'little')

# Entrada '.' no WIN203
win203_dir_data[0:11] = b'.          '
win203_dir_data[11] = 0x10
win203_dir_data[26:28] = win203_dir_cluster.to_bytes(2, 'little')
# Entrada '..' no WIN203 (aponta para raiz = cluster 0)
win203_dir_data[32:43] = b'..         '
win203_dir_data[43] = 0x10
win203_dir_data[58:60] = (0).to_bytes(2, 'little')

wentry_idx = 2
for item in win203_entries:
    raw_name, attr, date_bytes, size, payload = item
    if attr & 0x10:
        cl = pif_dir_cluster
        fsize = 0
    else:
        cl = allocate_chain(payload)
        fsize = size
    
    woff = wentry_idx * 32
    win203_dir_data[woff:woff+11] = raw_name
    win203_dir_data[woff+11] = attr
    win203_dir_data[woff+12:woff+26] = date_bytes
    win203_dir_data[woff+26:woff+28] = cl.to_bytes(2, 'little')
    win203_dir_data[woff+28:woff+32] = fsize.to_bytes(4, 'little')
    wentry_idx += 1

# Gravar WIN203 dir
woff = data_start + (win203_dir_cluster - 2) * bytes_per_clust
cbuf[woff:woff+bytes_per_clust] = win203_dir_data

# Entrada na raiz de c.img para WIN203
root_entry_off = root_offset + 10 * 32 # 11ª entrada (índice 10)
cbuf[root_entry_off : root_entry_off + 11] = b'WIN203     '
cbuf[root_entry_off + 11] = 0x10 # Diretório
cbuf[root_entry_off + 12 : root_entry_off + 26] = b'\x00' * 14
cbuf[root_entry_off + 26 : root_entry_off + 28] = win203_dir_cluster.to_bytes(2, 'little')
cbuf[root_entry_off + 28 : root_entry_off + 32] = (0).to_bytes(4, 'little')

# 3. Atualizar BOOTWIN.COM
# Código assembly:
# CMOS 0x5A -> exit 2 (Win 3.11)
# CMOS 0x20 -> exit 1 (Win 2.03)
# Outro -> exit 0 (MS-DOS)
bootwin_code = bytes([
    0xb0, 0x0e,             # mov al, 0x0e
    0xe6, 0x70,             # out 0x70, al
    0xe4, 0x71,             # in al, 0x71
    0x88, 0xc3,             # mov bl, al
    0xb0, 0x0e,             # mov al, 0x0e
    0xe6, 0x70,             # out 0x70, al
    0x30, 0xc0,             # xor al, al
    0xe6, 0x71,             # out 0x71, al
    0x80, 0xfb, 0x5a,       # cmp bl, 0x5a
    0x74, 0x08,             # je eh_win311 (+8)
    0x80, 0xfb, 0x20,       # cmp bl, 0x20
    0x74, 0x09,             # je eh_win203 (+9)
    0xb8, 0x00, 0x4c,       # mov ax, 0x4c00
    0xcd, 0x21,             # int 0x21
    # eh_win311:
    0xb8, 0x02, 0x4c,       # mov ax, 0x4c02
    0xcd, 0x21,             # int 0x21
    # eh_win203:
    0xb8, 0x01, 0x4c,       # mov ax, 0x4c01
    0xcd, 0x21              # int 0x21
])

# BOOTWIN.COM fica no cluster 2467, entrada 9 da raiz
bootwin_cluster = 2467
bootwin_data_off = data_start + (bootwin_cluster - 2) * bytes_per_clust
cbuf[bootwin_data_off : bootwin_data_off + len(bootwin_code)] = bootwin_code
# Atualizar tamanho na raiz (offset 45344)
bootwin_root_off = root_offset + 9 * 32
cbuf[bootwin_root_off + 28 : bootwin_root_off + 32] = len(bootwin_code).to_bytes(4, 'little')

# 4. Atualizar AUTOEXEC.BAT
new_autoexec = (
    b"@echo off\r\n"
    b"PROMPT $P$G\r\n"
    b"PATH C:\\DOS;C:\\WINDOWS;C:\\WIN203\r\n"
    b"SET TEMP=C:\\WINDOWS\\TEMP\r\n"
    b"MSCDEX.EXE /D:banana /L:R\r\n"
    b"DOSKEY.COM\r\n"
    b"MOUSE.COM\r\n"
    b"C:\\BOOTWIN.COM\r\n"
    b"IF ERRORLEVEL 2 GOTO WIN311\r\n"
    b"IF ERRORLEVEL 1 GOTO WIN203\r\n"
    b"GOTO FIM\r\n"
    b":WIN311\r\n"
    b"WIN /3\r\n"
    b"GOTO FIM\r\n"
    b":WIN203\r\n"
    b"CD \\WIN203\r\n"
    b"WIN.COM\r\n"
    b":FIM\r\n"
)

# AUTOEXEC.BAT fica no cluster 2468, entrada 7 da raiz
autoexec_cluster = 2468
autoexec_data_off = data_start + (autoexec_cluster - 2) * bytes_per_clust
cbuf[autoexec_data_off : autoexec_data_off + len(new_autoexec)] = new_autoexec
# Limpar o resto do cluster do AUTOEXEC.BAT
cbuf[autoexec_data_off + len(new_autoexec) : autoexec_data_off + bytes_per_clust] = b'\x00' * (bytes_per_clust - len(new_autoexec))
# Atualizar tamanho na raiz (offset 45280)
autoexec_root_off = root_offset + 7 * 32
cbuf[autoexec_root_off + 28 : autoexec_root_off + 32] = len(new_autoexec).to_bytes(4, 'little')

# Salvar c.img atualizado
with open(c_img_path, 'wb') as f:
    f.write(cbuf)

print(f'Sucesso! c.img atualizado. Próximo cluster livre: {next_free_cluster} (máximo 4017)')
