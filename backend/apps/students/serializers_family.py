from django.db.models import Q
from rest_framework import serializers
from apps.core.tenancy import studio_for_request

from apps.core.models import Family, Student, User


class ParentSerializer(serializers.ModelSerializer):
    """Simple serializer for parent user info"""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "email", "phone"]
        read_only_fields = [
            "email"
        ]  # Email usually unchangeable here for security, or managed via main User serializer


class FamilyMemberSerializer(serializers.ModelSerializer):
    """Simple student info for family view"""

    name = serializers.CharField(source="user.get_full_name", read_only=True)
    monthly_amount = serializers.SerializerMethodField()

    def get_monthly_amount(self, obj):
        contract = getattr(obj, "teaching_contract", None)
        return str(contract.monthly_amount) if contract else None

    class Meta:
        model = Student
        fields = ["id", "name", "instrument", "monthly_amount", "is_active"]


class FamilySerializer(serializers.ModelSerializer):
    """Serializer for Family model with nested parents and children"""

    primary_parent_details = ParentSerializer(source="primary_parent", read_only=True)
    secondary_parent_details = ParentSerializer(source="secondary_parent", read_only=True)
    students = FamilyMemberSerializer(many=True, read_only=True)
    display_name = serializers.CharField(source="__str__", read_only=True)

    class Meta:
        model = Family
        fields = [
            "id",
            "studio",
            "name", "display_name", "address_line1", "postal_code", "city",
            "ha_zone_entity_id", "contacts", "billing_recipient_name", "payment_method",
            "primary_parent",
            "primary_parent_details",
            "secondary_parent",
            "secondary_parent_details",
            "emergency_contact_name",
            "emergency_contact_phone",
            "address",
            "billing_email",
            "students",
            "created_at",
        ]
        read_only_fields = ["studio", "created_at"]
        extra_kwargs = {
            "primary_parent": {"required": False, "allow_null": True},
            "secondary_parent": {"required": False, "allow_null": True},
            "name": {"required": False},
        }
        validators = []

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError("Bitte einen Familiennamen eingeben.")
        return value.strip()

    def validate_ha_zone_entity_id(self, value):
        # Store the visible HA zone name, not a technical entity ID.
        return value.strip()

    def validate_contacts(self, value):
        if not isinstance(value, list) or len(value) > 20:
            raise serializers.ValidationError("Bitte maximal 20 Ansprechpartner angeben.")
        result = []
        for entry in value:
            if not isinstance(entry, dict) or set(entry) - {"name", "first_name", "last_name", "relation", "email", "phone"}:
                raise serializers.ValidationError("Ungültige Ansprechpartnerdaten.")
            clean = {}
            for key in ("name", "first_name", "last_name", "relation", "email", "phone"):
                field = serializers.EmailField(allow_blank=True, max_length=254) if key == "email" else serializers.CharField(allow_blank=True, max_length=200)
                clean[key] = field.run_validation(entry.get(key, ""))
            if not (clean["first_name"] or clean["last_name"]):
                parts = clean["name"].split(maxsplit=1)
                clean["first_name"] = parts[0] if len(parts)==2 else ""
                clean["last_name"] = parts[-1] if parts else ""
            clean["name"] = " ".join(x for x in (clean["first_name"], clean["last_name"]) if x)
            if not clean["name"]:
                raise serializers.ValidationError("Jeder Ansprechpartner benötigt einen Namen.")
            result.append(clean)
        return result

    def validate(self, attrs):
        request = self.context.get("request")
        studio = self.instance.studio if self.instance else studio_for_request(request)
        if not self.instance and not attrs.get("name") and not attrs.get("primary_parent"):
            raise serializers.ValidationError({"name": "Bitte einen Familiennamen eingeben."})
        # Existing account links are retained; do not grant access to unrelated users.
        for key in ("primary_parent", "secondary_parent"):
            if key not in attrs or attrs[key] is None:
                continue
            parent = attrs[key]
            if parent.role != "parent" or studio is None or not Family.objects.filter(studio=studio).filter(
                Q(primary_parent=parent) | Q(secondary_parent=parent)
            ).exists():
                raise serializers.ValidationError({key: "Nur bereits diesem Studio zugeordnete Elternkonten sind zulässig."})
        return attrs
