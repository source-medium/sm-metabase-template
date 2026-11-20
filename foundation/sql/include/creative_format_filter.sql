-- The Creative format filter matches each creative's latest format (latest_format) by the name the
-- formats table shows, so a format a platform left blank, shown as (none), filters too. The question
-- joins latest_formats to its rows before this.
[[AND latest_formats.creative_format = {{creative_format}}]]
