# Core Product Identity

- **Product Name** — *Text*
- **Vendor / Brand** — *Text* (displayed; brand collection links will live at the brand level below)
- **Product Type (category)** — *Single-select list*
  - American Whiskey, Scotch Whisky, Irish Whiskey, Japanese Whisky, World Whiskey, Rum, Brandy, Tequila, Wine, Liqueur, or Other
  - Note: “American Single Malt” is a **style** under American Whiskey; TTB recognized it as a formal type in Dec 2024—so include it in Sub-Category below.
- **Sub-Type (style / subtype)** — *Single-select list with “Other” option*
  - **American Whiskey:** Bourbon, Rye, **American Single Malt**, Wheat, Corn, Blended American, Other
  - **Scotch Whisky:** Single Malt, Blended Malt, Blended Scotch, Single Grain, Blended Grain (keep official 5-region system; “Islands” is informal)
  - **Irish Whiskey:** Single Pot Still, Single Malt, Single Grain, Blended
  - **Japanese Whisky:** Single Malt, Blended, Grain, Other
  - **World Whiskey (examples):** Canadian (Rye), Indian Single Malt, Taiwanese Single Malt, English Single Malt, Australian Single Malt, Swedish Single Malt, French Single Malt, Other
  - **Rum:** Agricole, Jamaican, Demerara, Spanish-style, Overproof, Spiced, Other
  - **Cognac:** VS, VSOP, XO, XXO, Hors d’Âge
  - **Brandy:** Armagnac, Calvados, Grape Brandy, Fruit Brandy
  - **Tequila:** Blanco, Joven/Gold, Reposado, Añejo, Extra Añejo

---

# Bottle & Packaging Details

- **Volume (ml)** — *Integer*
- **ABV (%)** — *Decimal* (e.g., 47.5)
- **Gift Packaging Available** — *Boolean* (Yes/No)
- **UPC** — *Text*
- **SKU** — *Text* (can equal UPC if that’s your convention)

---

# Production & Origin

- **Country of Origin** — *Single-select list*
  - USA, Scotland, Ireland, Japan, Canada, Taiwan, India, England, Wales, Israel, Australia, New Zealand, France, Sweden, Germany, Mexico, Caribbean (Rum), Other
- **Region / State** — *Single-select list (depends on Country)*
  - **USA:** Alabama, Alaska, Arizona, Arkansas, California, Colorado, Connecticut, Delaware, Florida, Georgia, Hawaii, Idaho, Illinois, Indiana, Iowa, Kansas, Kentucky, Louisiana, Maine, Maryland, Massachusetts, Michigan, Minnesota, Mississippi, Missouri, Montana, Nebraska, Nevada, New Hampshire, New Jersey, New Mexico, New York, North Carolina, North Dakota, Ohio, Oklahoma, Oregon, Pennsylvania, Rhode Island, South Carolina, South Dakota, Tennessee, Texas, Utah, Vermont, Virginia, Washington, West Virginia, Wisconsin, Wyoming, Other (USA)
  - **Scotland:** Campbeltown, Highland, Islay, Lowland, Speyside
  - **Ireland:** Connacht, Leinster, Munster, Ulster
  - **Japan:** Hokkaido, Tohoku, Kanto, Chubu, Kansai (Kinki), Chugoku, Shikoku, Kyushu-Okinawa
  - **World:** e.g., Taipei (Taiwan), Goa (India), Tasmania/VIC/NSW/WA/SA (AU), Brittany/Alsace (FR), Skåne (SE), Other (World)
- **Age Statement** — *Integer* (years, whole numbers only)
- **Mashbill / Grain Breakdown** — *Text* (e.g., “75% corn, 15% rye, 10% malted barley”)

---

# Characteristics — Cask Type & Special Characteristics

- **Cask Strength** — *Boolean*
- **Single Barrel** — *Boolean*
- **Store Pick** — *Boolean*
  - **Pick Owner** — *Single-select (shown when Store Pick = Yes):* Whiskey Library, Partner Retailer, Distillery, Other
- **Finished (secondary cask)** — *Boolean*
- **Cask Wood (multi-select):** American Oak, European Oak, French Oak, Mizunara, Amburana, Acacia, Chestnut, Other
- **Cask / Finish Type (multi-select):**
  - **Sherry:** Oloroso, PX, Fino, Amontillado, Manzanilla
  - **Port:** Ruby, Tawny
  - Madeira, Marsala, Sauternes, Tokaji, Red Wine (Cabernet/Bordeaux/Burgundy/Pinot Noir/Rioja), White Wine (Chardonnay, Albariño), Rum, Cognac, Armagnac, Calvados, Tequila, Beer (Stout, IPA), Ice Wine, Other

---

# Tasting Profile

- **Nose / Palate / Finish (multi-select + allow “Other”):**
  - vanilla, caramel, toffee, honey, brown sugar, chocolate, cocoa, coffee, dried fruit, raisin, date, fig, red fruit, stone fruit, orchard fruit, citrus, tropical, malt, biscuit, nutty, almond, hazelnut, peanut brittle, baking spice, cinnamon, clove, nutmeg, pepper, herbal, floral, oak, cedar, tobacco, leather, smoke/peat, maritime/brine, earthy, mint/eucalyptus
- **Pairings (multi-select):** Chocolate, Cheese, BBQ, Dessert, Cigars, Other

---

# Accolades & Validation

- **Awards** — *Repeatable block (or metaobject list)*:
  - Competition (SFWSC, IWSC, ISC, World Whiskies Awards, ASCOT, Ultimate Spirits Challenge, The Spirits Business, Other)
  - Year (int)
  - Medal (Double Gold/Best in Class, Gold, Silver, Bronze, Category Winner)
  - Badge Image (file)
  - Notes (text)
- **Critic Ratings** — *Repeatable block (or metaobject list)*:
  - Source (Whisky Advocate, Wine Enthusiast, Whisky Magazine, Distiller, Breaking Bourbon, Other)
  - Score (0–100 decimal)
  - Quote (short text)
  - URL

---

# Brand Metadata (Collection Level)

- **Brand / Distillery Story (short)** — *Short text*
- **Brand / Distillery Story (long)** — *Rich text*
- **Founding Year** — *Integer (year)*
- **Country** — *Single-select* (same list as Product)
- **Region** — *Single-select* (same controlled lists as Product)
- **Facility Images** — *Media (one or many)*






