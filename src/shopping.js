// shortcut: the local English vocabulary replaces Apple's downloaded classifier; expand from audited predictions.
export const shoppingCategories = [
  ["produce", "Produce", "apple apples banana bananas orange oranges lemon lemons lime limes pear pears grape grapes strawberry strawberries blueberry blueberries raspberry raspberries avocado avocados tomato tomatoes potato potatoes onion onions carrot carrots broccoli lettuce spinach cucumber cucumbers pepper peppers mushroom mushrooms courgette courgettes aubergine aubergines celery cabbage garlic ginger fruit vegetables"],
  ["dairy", "Dairy, Eggs & Cheese", "milk cream butter yoghurt yogurt cheese cheddar mozzarella parmesan egg eggs"],
  ["meat", "Meat", "chicken beef pork lamb turkey steak steaks bacon sausage sausages mince ham"],
  ["seafood", "Seafood", "salmon tuna cod haddock prawn prawns shrimp fish mussels lobster crab"],
  ["bakery", "Bread & Cereals", "bread bagel bagels baguette croissant croissants cereal cereals oats oatmeal porridge granola tortilla tortillas pita pitta rolls"],
  ["frozen", "Frozen Foods", "frozen ice-cream icecream"],
  ["snacks", "Snacks & Sweets", "chocolate chocolates crisps chips biscuit biscuits cookie cookies sweets candy cracker crackers popcorn pretzel pretzels nuts"],
  ["drinks", "Beverages", "water juice coffee tea soda lemonade cola beer wine cider squash"],
  ["pasta", "Pasta, Rice & Beans", "pasta spaghetti macaroni noodle noodles rice bean beans lentil lentils chickpea chickpeas couscous quinoa"],
  ["tins", "Tinned Foods & Soups", "tinned canned soup soups"],
  ["baking", "Baking Items", "flour sugar yeast baking-powder icing cocoa vanilla cornstarch cornflour"],
  ["condiments", "Sauces & Condiments", "ketchup mayonnaise mustard vinegar oil olive-oil honey jam peanut-butter sauce gravy soy-sauce salt peppercorn peppercorns spice spices"],
  ["household", "Household Items", "detergent bleach cleaner sponge sponges washing-up-liquid dishwasher-tablets bin-bags kitchen-roll toilet-paper toilet-roll batteries lightbulb lightbulbs foil cling-film"],
  ["health", "Health & Beauty", "shampoo conditioner soap toothpaste toothbrush deodorant sunscreen moisturiser moisturizer aspirin paracetamol ibuprofen vitamins"],
  ["pet", "Pet Care", "dog-food cat-food pet-food litter"],
].map(([id, name, words]) => ({ id, name, words: words.split(" ") }));

const phrases = [
  ["frozen", /\bfrozen\b|\bice cream\b/],
  ["pet", /\b(?:dog|cat|pet) (?:food|treats)\b|\bcat litter\b/],
  ["household", /\b(?:washing up liquid|dishwasher tablets|bin bags|kitchen roll|toilet (?:paper|roll)|cling film)\b/],
  ["condiments", /\b(?:olive oil|peanut butter|soy sauce|black pepper)\b/],
  ["baking", /\bbaking (?:powder|soda)\b/],
  ["tins", /\b(?:tinned|canned)\b/],
];

export function shoppingItemKey(title) {
  return title.normalize("NFKC").toLocaleLowerCase("en-GB")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
}

export function shoppingCategory(title) {
  const key = shoppingItemKey(title);
  const phrase = phrases.find(([, pattern]) => pattern.test(key));
  if (phrase) return phrase[0];
  const words = new Set(key.split(" "));
  return shoppingCategories.find(category => category.words.some(word => words.has(word)))?.id || null;
}

// All mutation paths call this before persisting so sections and learned choices reach the API together.
export function categoriseShopping(data, previous = null) {
  let reminders = data.reminders;
  const oldReminders = new Map((previous?.reminders || []).map(row => [row.id, row]));
  const lists = data.lists.map(list => {
    if (list.type !== "shopping") return list;
    const sections = [...list.sections];
    const sectionIds = new Set(sections.map(section => section.id));
    const overrides = [...(list.shoppingOverrides || [])].filter(choice => choice.sectionId === null || sectionIds.has(choice.sectionId));
    const sectionFor = categoryId => {
      if (!categoryId) return null;
      const category = shoppingCategories.find(category => category.id === categoryId);
      const existing = sections.find(section => section.shoppingCategory === categoryId || section.name === category.name);
      if (existing) return existing.id;
      const section = { id: globalThis.crypto.randomUUID(), name: category.name, shoppingCategory: categoryId };
      sections.push(section);
      return section.id;
    };
    const listRows = new Map();
    reminders = reminders.map(row => {
      if (row.listId !== list.id || row.parentId !== null) return row;
      const old = oldReminders.get(row.id);
      const title = shoppingItemKey(row.title);
      const targetCategory = sections.find(section => section.id === row.sectionId)?.shoppingCategory;
      const moved = old?.listId === row.listId && old.sectionId !== row.sectionId &&
        (row.shoppingCategoryManual || !targetCategory || targetCategory !== shoppingCategory(row.title));
      const previousList = previous?.lists.find(item => item.id === row.listId);
      const explicit = moved || row.shoppingCategoryManual ||
        ((!old || previousList?.type !== "shopping") && row.sectionId !== null && row.shoppingCategoryManual !== false);
      const existingChoice = overrides.find(choice => choice.title === title);
      const learn = moved || (explicit && (
        (old && shoppingItemKey(old.title) !== title) ||
        (!old && (previousList || !existingChoice)) ||
        (previousList && previousList.type !== "shopping" && !existingChoice)
      ));
      let sectionId = row.sectionId;
      if (row.shoppingNewSectionName !== undefined) {
        const section = { id: globalThis.crypto.randomUUID(), name: row.shoppingNewSectionName.trim() };
        sections.push(section);
        sectionId = section.id;
      }
      if (row.shoppingCategoryChoice !== undefined) sectionId = sectionFor(row.shoppingCategoryChoice);
      if (learn || row.shoppingCategoryChoice !== undefined || row.shoppingNewSectionName !== undefined) {
        const index = overrides.findIndex(choice => choice.title === title);
        const choice = { title, sectionId };
        if (index === -1) overrides.push(choice); else overrides[index] = choice;
      } else if (!explicit) {
        const choice = overrides.find(choice => choice.title === title);
        sectionId = choice ? choice.sectionId : sectionFor(shoppingCategory(row.title));
      }
      const { shoppingCategoryChoice, shoppingNewSectionName, ...stored } = row;
      const result = { ...stored, sectionId, shoppingCategoryManual: Boolean(explicit || overrides.some(choice => choice.title === title)) };
      listRows.set(result.id, result);
      return result;
    });
    // Children remain with their parent; category moves never destroy the subtask hierarchy.
    const inherit = row => {
      const parent = listRows.get(row.parentId);
      if (!parent) return row;
      const result = { ...row, sectionId: parent.sectionId };
      listRows.set(row.id, result);
      return result;
    };
    for (let depth = 0; depth < reminders.length; depth++) {
      let changed = false;
      reminders = reminders.map(row => {
        if (row.listId !== list.id || row.parentId === null) return row;
        if (!listRows.has(row.id) && listRows.has(row.parentId)) changed = true;
        const result = inherit(row);
        if (result.sectionId !== row.sectionId) changed = true;
        return result;
      });
      if (!changed) break;
    }
    return { ...list, sections, shoppingOverrides: overrides.slice(-1000) };
  });
  return { ...data, lists, reminders };
}

export function moveShoppingItem(data, reminderId, sectionId) {
  const row = data.reminders.find(row => row.id === reminderId);
  const list = data.lists.find(list => list.id === row?.listId);
  if (!row || list?.type !== "shopping" || (sectionId !== null && !list.sections.some(section => section.id === sectionId))) return data;
  return categoriseShopping({ ...data, reminders: data.reminders.map(item => item.id === row.id ? { ...item, parentId: null, sectionId, shoppingCategoryManual: true } : item) }, data);
}

export function resetShoppingCategories(data, listId) {
  return categoriseShopping({
    ...data,
    lists: data.lists.map(list => list.id === listId ? { ...list, shoppingOverrides: [] } : list),
    reminders: data.reminders.map(row => row.listId === listId ? { ...row, sectionId: null, shoppingCategoryManual: false } : row),
  });
}
