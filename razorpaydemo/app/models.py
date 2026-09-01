import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Float, Integer, Boolean, DateTime, ForeignKey,
    UniqueConstraint, Index, JSON, Text
)
from sqlalchemy.orm import relationship

from app.database import Base


def gen_uuid():
    return str(uuid.uuid4())


class Customer(Base):
    __tablename__ = "customers"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    external_ref = Column(String(128), unique=True, index=True)
    email = Column(String(256))
    created_at = Column(DateTime, default=datetime.utcnow)

    payments = relationship("Payment", back_populates="customer")


class Payment(Base):
    __tablename__ = "payments"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    customer_id = Column(String(36), ForeignKey("customers.id"), index=True)
    razorpay_payment_id = Column(String(128), unique=True, nullable=True, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String(8), default="INR")
    status = Column(String(32), index=True)  # failed | captured | refunded
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    customer = relationship("Customer", back_populates="payments")


class Subscription(Base):
    __tablename__ = "subscriptions"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    customer_id = Column(String(36), ForeignKey("customers.id"), index=True)
    plan_ref = Column(String(128))
    status = Column(String(32))
    created_at = Column(DateTime, default=datetime.utcnow)


class RevenueLeakEvent(Base):
    """A case: a unit of at-risk revenue that may or may not self-cure."""
    __tablename__ = "revenue_leak_events"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    case_ref = Column(String(32), unique=True, index=True)  # e.g. C-1042
    customer_id = Column(String(36), ForeignKey("customers.id"), index=True)
    payment_id = Column(String(36), ForeignKey("payments.id"), nullable=True)
    leak_type = Column(String(32), index=True)  # subscription|cart|invoice|mandate|payment_link
    amount_at_risk = Column(Float, nullable=False)
    status = Column(String(32), default="open", index=True)  # open|recovered|suppressed|locked|closed
    natural_recovery_prob = Column(Float, nullable=True)
    model_version = Column(String(32), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    resolved_at = Column(DateTime, nullable=True)

    interventions = relationship("Intervention", back_populates="leak_event")
    decision_traces = relationship("DecisionTrace", back_populates="leak_event")


class Intervention(Base):
    __tablename__ = "interventions"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    leak_event_id = Column(String(36), ForeignKey("revenue_leak_events.id"), index=True)
    action_type = Column(String(32))  # wait|payment_link|voice|human
    predicted_recovery_prob = Column(Float)
    predicted_incremental_prob = Column(Float)
    expected_incremental_value = Column(Float)
    cost = Column(Float, default=0)
    executed = Column(Boolean, default=False)
    executed_at = Column(DateTime, nullable=True)
    provider_ref = Column(String(128), nullable=True)  # e.g. Razorpay payment_link id

    leak_event = relationship("RevenueLeakEvent", back_populates="interventions")


class ExperimentAssignment(Base):
    __tablename__ = "experiment_assignments"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    leak_event_id = Column(String(36), ForeignKey("revenue_leak_events.id"), index=True)
    arm = Column(String(32))  # control | baseline | our_policy
    assigned_at = Column(DateTime, default=datetime.utcnow)


class Outcome(Base):
    __tablename__ = "outcomes"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    leak_event_id = Column(String(36), ForeignKey("revenue_leak_events.id"), index=True)
    recovered_amount = Column(Float, default=0)
    recovered_at = Column(DateTime, nullable=True)
    attribution_category = Column(String(32), nullable=True)  # self_cure|intervention_attributed|uncertain|not_recovered
    confidence = Column(Float, nullable=True)


class BudgetLedger(Base):
    __tablename__ = "budget_ledger"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    resource = Column(String(32))  # money|contact|voice|human
    delta = Column(Float)
    balance_after = Column(Float)
    reason = Column(String(256))
    leak_event_id = Column(String(36), ForeignKey("revenue_leak_events.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class PolicyAuditLog(Base):
    __tablename__ = "policy_audit_log"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    leak_event_id = Column(String(36), ForeignKey("revenue_leak_events.id"), index=True)
    check_name = Column(String(64))
    passed = Column(Boolean)
    reason = Column(String(256), nullable=True)
    policy_version = Column(String(16))
    created_at = Column(DateTime, default=datetime.utcnow)


class AgentRegistry(Base):
    __tablename__ = "agent_registry"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    customer_id = Column(String(36), ForeignKey("customers.id"), index=True)
    agent_name = Column(String(64))  # subscription_agent|cart_agent|our_agent|human_queue
    status = Column(String(16))  # active|idle|blocked
    last_event_at = Column(DateTime, default=datetime.utcnow)
    simulated = Column(Boolean, default=True)  # external agent state is always simulator-backed unless verified


class PromiseToPay(Base):
    __tablename__ = "promises_to_pay"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    leak_event_id = Column(String(36), ForeignKey("revenue_leak_events.id"), index=True)
    customer_id = Column(String(36), ForeignKey("customers.id"))
    amount = Column(Float)
    promise_text = Column(String(256))
    promise_date = Column(DateTime)
    deadline = Column(DateTime)
    status = Column(String(16), default="active")  # active|fulfilled|broken
    created_at = Column(DateTime, default=datetime.utcnow)


class WebhookEvent(Base):
    __tablename__ = "webhook_events"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    provider_event_id = Column(String(128), unique=True, index=True)  # dedupe key
    event_type = Column(String(64), index=True)
    raw_payload = Column(JSON)
    signature_valid = Column(Boolean)
    processed = Column(Boolean, default=False)
    received_at = Column(DateTime, default=datetime.utcnow, index=True)
    processed_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_webhook_dedupe", "provider_event_id"),)


class DecisionTrace(Base):
    __tablename__ = "decision_traces"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    leak_event_id = Column(String(36), ForeignKey("revenue_leak_events.id"), index=True)
    stage = Column(String(64))
    input_json = Column(JSON)
    output_json = Column(JSON)
    model_version = Column(String(32), nullable=True)
    policy_version = Column(String(32), nullable=True)
    reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    leak_event = relationship("RevenueLeakEvent", back_populates="decision_traces")


class ModelVersion(Base):
    __tablename__ = "model_versions"
    id = Column(String(36), primary_key=True, default=gen_uuid)
    name = Column(String(64))  # natural_recovery|uplift_payment_link|...
    version = Column(String(16))
    trained_at = Column(DateTime, default=datetime.utcnow)
    metrics_json = Column(JSON, nullable=True)
    active = Column(Boolean, default=True)
