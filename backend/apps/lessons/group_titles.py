"""Display names for shared teaching appointments, independent of roster names."""


def group_title(name, *, family):
    prefix = "Familie" if family else "Gruppe"
    name = (name or "").strip()
    if not name or name.casefold() == prefix.casefold():
        return prefix
    head, *rest = name.split(maxsplit=1)
    if head.casefold() == prefix.casefold():
        return prefix + (" " + rest[0] if rest else "")
    return prefix + " " + name


def lesson_group_title(lesson):
    if lesson.teaching_family_id or lesson.teaching_group_id:
        source = lesson.teaching_family if lesson.teaching_family_id else lesson.teaching_group
        return group_title(lesson.group_name_snapshot or str(source), family=bool(lesson.teaching_family_id))
    return lesson.group_name_snapshot or ""
