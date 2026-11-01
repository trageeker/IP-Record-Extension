from PIL import Image, ImageDraw
def draw(fill, ring, check=False, S=512):
    im = Image.new("RGBA", (S, S), (0,0,0,0)); d = ImageDraw.Draw(im)
    pad = S*0.06; d.rounded_rectangle([pad,pad,S-pad,S-pad], radius=S*0.22, fill=fill)
    c=S/2; r=S*0.29; w=int(S*0.045)
    d.ellipse([c-r,c-r,c+r,c+r], outline=ring, width=w)
    d.ellipse([c-r*0.45,c-r,c+r*0.45,c+r], outline=ring, width=w)
    d.line([c-r,c,c+r,c], fill=ring, width=w); d.line([c,c-r,c,c+r], fill=ring, width=w)
    for y in (c-r*0.55, c+r*0.55):
        dx=(r*r-(y-c)**2)**0.5; d.line([c-dx,y,c+dx,y], fill=ring, width=w)
    if check:
        R=S*0.2; cx, cy = S-pad-R*0.9, S-pad-R*0.9
        d.ellipse([cx-R,cy-R,cx+R,cy+R], fill=(255,255,255,255))
        d.ellipse([cx-R*0.8,cy-R*0.8,cx+R*0.8,cy+R*0.8], fill=(22,163,74,255))
        d.line([(cx-R*0.4,cy),(cx-R*0.08,cy+R*0.32),(cx+R*0.45,cy-R*0.32)], fill="white", width=int(S*0.05), joint="curve")
    return im
sets = {"app": draw((37,99,235,255),(255,255,255,255)),
        "none": draw((140,148,160,255),(255,255,255,255)),
        "has": draw((37,99,235,255),(255,255,255,255),check=True)}
for k,im in sets.items():
    for s in (16,32,48,128): im.resize((s,s), Image.LANCZOS).save(f"src/icons/{k}-{s}.png")
prev=Image.new("RGBA",(3*140,140),(255,255,255,255))
for i,k in enumerate(sets): prev.paste(sets[k].resize((128,128),Image.LANCZOS),(i*140+6,6),sets[k].resize((128,128),Image.LANCZOS))
prev.save("/tmp/icons-preview.png")
