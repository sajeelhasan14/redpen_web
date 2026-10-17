import hmac
import os
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .rubric import TYPES
from .runner import run_in_child
from .transitions import KINDS

app = FastAPI()


class Line(BaseModel):
    n: int
    latex: str = Field(max_length=400)


class Substitution(BaseModel):
    variable: str = Field(pattern=r"^[A-Za-z]$")
    latex: str = Field(max_length=100)


class Transition(BaseModel):
    to: int
    kind: str
    substitution: Optional[Substitution] = None


class Point(BaseModel):
    id: str = Field(pattern=r"^P\d+$")
    type: str
    expected: str
    followThrough: bool = False
    requireConstant: bool = False
    line: Optional[int] = None


class CheckRequest(BaseModel):
    variable: str
    variables: List[str]
    given: Optional[str] = None
    lines: List[Line] = Field(max_length=60)
    transitions: List[Transition] = Field(max_length=60)
    points: List[Point] = Field(max_length=20)
    finalPoint: Optional[str] = None


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/check")
def check(req: CheckRequest, x_checker_secret: Optional[str] = Header(default=None)):
    secret = os.environ.get("CHECKER_SECRET", "")
    if not secret:
        raise HTTPException(503, "CHECKER_SECRET is not set")
    if not hmac.compare_digest(secret.encode(), (x_checker_secret or "").encode()):
        raise HTTPException(401, "bad secret")
    for t in req.transitions:
        if t.kind not in KINDS:
            raise HTTPException(422, "unknown transition kind")
    for p in req.points:
        if p.type not in TYPES:
            raise HTTPException(422, "unknown check type")
    result = run_in_child(req.model_dump())
    if result is None:
        raise HTTPException(504, "check did not finish")
    return result
