-- Private bag pages walk an owner/origin index; history already has (item_id, sequence).
CREATE INDEX realm_items_owner_page ON realm_items (kingdom_id, (record->>'ownerId'), (record->>'origin'), id)
  WHERE record->>'place' <> 'spent';
