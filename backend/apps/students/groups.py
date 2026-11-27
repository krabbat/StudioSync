"""Manage teaching rosters without modifying historical calendar participation."""
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from apps.core.models import Student, TeachingGroup
from apps.core.tenancy import studio_for_request, studios_for_request


class TeachingGroupSerializer(serializers.ModelSerializer):
    members = serializers.SerializerMethodField()
    student_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False, max_length=100)

    class Meta:
        model = TeachingGroup
        fields = ["id","name","members","student_ids"]

    def get_members(self, obj):
        return [{"id":str(s.pk),"name":s.user.get_full_name(),"is_active":s.is_active}
                for s in obj.members.select_related("user").order_by("user__last_name","user__first_name")]

    def validate_student_ids(self, ids):
        studio = self.instance.studio if self.instance else studio_for_request(self.context["request"])
        rows = list(Student.objects.filter(studio=studio, pk__in=ids,user__role="student"))
        if len(rows)!=len(set(ids)) or len(ids)!=len(set(ids)):
            raise serializers.ValidationError("invalid_members", code="invalid_members")
        return rows

    def create(self, validated_data):
        members=validated_data.pop("student_ids",[])
        obj=super().create(validated_data)
        obj.members.set(members)
        return obj

    def update(self, instance, validated_data):
        members=validated_data.pop("student_ids",None)
        obj=super().update(instance,validated_data)
        if members is not None: obj.members.set(members)
        return obj


class TeachingGroupViewSet(viewsets.ModelViewSet):
    serializer_class=TeachingGroupSerializer
    permission_classes=[IsAuthenticated]
    pagination_class=None

    def get_queryset(self):
        if self.request.user.role!="admin":
            return TeachingGroup.objects.none()
        return TeachingGroup.objects.filter(studio__in=studios_for_request(self.request),archived_at__isnull=True)

    def perform_create(self, serializer):
        if self.request.user.role!="admin":
            raise PermissionDenied()
        studio=studio_for_request(self.request)
        if studio is None: raise PermissionDenied()
        serializer.save(studio=studio)

    def perform_destroy(self, instance):
        instance.archived_at=timezone.now()
        instance.save(update_fields=["archived_at"])
